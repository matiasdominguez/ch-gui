use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::error::AppResult;

/// Callers use the returned `Arc` without the pool mutex. Holding the mutex across a query would
/// make every pool command wait for that query to finish.
pub struct Pool<T> {
    inner: Arc<Mutex<HashMap<String, Arc<T>>>>,
}

impl<T> Default for Pool<T> {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl<T> Pool<T> {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn get_or_insert<F, Fut, A>(
        &self,
        key: &str,
        is_alive: A,
        connect: F,
    ) -> AppResult<Arc<T>>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = AppResult<T>>,
        A: Fn(&T) -> bool,
    {
        {
            let pools = self.inner.lock().await;
            if let Some(c) = pools.get(key) {
                if is_alive(c) {
                    return Ok(Arc::clone(c));
                }
            }
        }

        // Holding the mutex across `connect` would block every other pool user until the connection opens.
        let built = Arc::new(connect().await?);

        // Another caller may have filled the slot during `connect`. That entry stays, and this one drops.
        let mut pools = self.inner.lock().await;
        if let Some(existing) = pools.get(key) {
            if is_alive(existing) {
                return Ok(Arc::clone(existing));
            }
        }
        pools.insert(key.to_string(), Arc::clone(&built));
        Ok(built)
    }

    pub async fn remove(&self, key: &str) {
        self.inner.lock().await.remove(key);
    }

    #[cfg(test)]
    pub async fn len(&self) -> usize {
        self.inner.lock().await.len()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    use super::*;

    #[tokio::test]
    async fn caches_by_key_and_reuses() {
        let pool: Pool<u32> = Pool::new();
        let calls = AtomicUsize::new(0);

        for _ in 0..5 {
            let got = pool
                .get_or_insert(
                    "k",
                    |_| true,
                    || async {
                        calls.fetch_add(1, Ordering::SeqCst);
                        Ok(42u32)
                    },
                )
                .await
                .unwrap();
            assert_eq!(*got, 42);
        }
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "connect ran more than once"
        );
        assert_eq!(pool.len().await, 1);
    }

    #[tokio::test]
    async fn different_keys_get_separate_entries() {
        let pool: Pool<String> = Pool::new();
        let a = pool
            .get_or_insert("a", |_| true, || async { Ok("first".to_string()) })
            .await
            .unwrap();
        let b = pool
            .get_or_insert("b", |_| true, || async { Ok("second".to_string()) })
            .await
            .unwrap();
        assert_eq!(&*a, "first");
        assert_eq!(&*b, "second");
        assert_eq!(pool.len().await, 2);
    }

    #[tokio::test]
    async fn dead_entries_are_rebuilt() {
        let pool: Pool<u32> = Pool::new();
        let seed = pool
            .get_or_insert("k", |_| true, || async { Ok(7u32) })
            .await
            .unwrap();
        assert_eq!(*seed, 7);

        let rebuilt = pool
            .get_or_insert("k", |&v| v != 7, || async { Ok(9u32) })
            .await
            .unwrap();
        assert_eq!(*rebuilt, 9);
    }

    #[tokio::test]
    async fn remove_evicts_entry() {
        let pool: Pool<u32> = Pool::new();
        pool.get_or_insert("k", |_| true, || async { Ok(1u32) })
            .await
            .unwrap();
        assert_eq!(pool.len().await, 1);

        pool.remove("k").await;
        assert_eq!(pool.len().await, 0);
    }

    #[tokio::test]
    async fn concurrent_users_do_not_serialize_on_pool_lock() {
        let pool: Arc<Pool<()>> = Arc::new(Pool::new());
        pool.get_or_insert("k", |_| true, || async { Ok(()) })
            .await
            .unwrap();

        let start = std::time::Instant::now();
        let mut handles = Vec::new();
        for _ in 0..8 {
            let p = Arc::clone(&pool);
            handles.push(tokio::spawn(async move {
                let got = p
                    .get_or_insert("k", |_| true, || async { Ok(()) })
                    .await
                    .unwrap();
                tokio::time::sleep(Duration::from_millis(100)).await;
                drop(got);
            }));
        }
        for h in handles {
            h.await.unwrap();
        }
        let elapsed = start.elapsed();
        assert!(
            elapsed < Duration::from_millis(300),
            "pool appears to serialize callers — 8x100ms concurrent took {elapsed:?} (expected ~100ms)",
        );
    }

    #[tokio::test]
    async fn slow_connect_does_not_block_other_keys() {
        let pool: Arc<Pool<u32>> = Arc::new(Pool::new());
        let pool_a = Arc::clone(&pool);
        let pool_b = Arc::clone(&pool);

        let start = std::time::Instant::now();
        let slow = tokio::spawn(async move {
            pool_a
                .get_or_insert(
                    "slow",
                    |_| true,
                    || async {
                        tokio::time::sleep(Duration::from_millis(200)).await;
                        Ok(1u32)
                    },
                )
                .await
                .unwrap();
        });
        // Let the slow task take and release the first lock so it is inside `connect`.
        tokio::time::sleep(Duration::from_millis(10)).await;
        let fast = tokio::spawn(async move {
            pool_b
                .get_or_insert("fast", |_| true, || async { Ok(2u32) })
                .await
                .unwrap()
        });

        let fast_val = fast.await.unwrap();
        let fast_elapsed = start.elapsed();
        assert_eq!(*fast_val, 2);
        assert!(
            fast_elapsed < Duration::from_millis(150),
            "slow connect() blocked an unrelated key — fast insert took {fast_elapsed:?}"
        );
        slow.await.unwrap();
    }
}
