use crate::clickhouse::Client;
use crate::pool::Pool;

/// klickhouse runs one query per connection, so two pools keep monitoring polls and editor queries from waiting on each other.
pub struct AppState {
    pub pools: Pool<Client>,
    pub monitor_pools: Pool<Client>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            pools: Pool::new(),
            monitor_pools: Pool::new(),
        }
    }
}
