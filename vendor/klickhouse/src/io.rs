use std::future::Future;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::{KlickhouseError, Result};

use crate::protocol::MAX_STRING_SIZE;

pub trait ClickhouseRead: AsyncRead + Unpin + Send + Sync {
    fn read_var_uint(&mut self) -> impl Future<Output = Result<u64>> + Send;

    fn read_string(&mut self) -> impl Future<Output = Result<Vec<u8>>> + Send;

    /// chgui patch: invalid UTF-8 becomes `\xNN`. ClickHouse copies literal bytes into column names, type names, and
    /// exception text, so a strict decode would fail the query or hide the server's error. Unlike
    /// U+FFFD, escaping keeps distinct bytes distinct, so `['\xFF']` and `['\xFE']` stay two columns.
    fn read_utf8_string(&mut self) -> impl Future<Output = Result<String>> + Send {
        async {
            let bytes = self.read_string().await?;
            let mut out = String::with_capacity(bytes.len());
            for chunk in bytes.utf8_chunks() {
                out.push_str(chunk.valid());
                for b in chunk.invalid() {
                    out.push_str(&format!("\\x{b:02X}"));
                }
            }
            Ok(out)
        }
    }
}

impl<T: AsyncRead + Unpin + Send + Sync> ClickhouseRead for T {
    async fn read_var_uint(&mut self) -> Result<u64> {
        let mut out = 0u64;
        for i in 0..9u64 {
            let mut octet = [0u8];
            self.read_exact(&mut octet[..]).await?;
            out |= ((octet[0] & 0x7F) as u64) << (7 * i);
            if (octet[0] & 0x80) == 0 {
                break;
            }
        }
        Ok(out)
    }

    async fn read_string(&mut self) -> Result<Vec<u8>> {
        let len = self.read_var_uint().await?;
        if len as usize > MAX_STRING_SIZE {
            return Err(KlickhouseError::ProtocolError(format!(
                "string too large: {} > {}",
                len, MAX_STRING_SIZE
            )));
        }
        if len == 0 {
            return Ok(vec![]);
        }
        let mut buf = vec![0u8; len as usize];
        self.read_exact(&mut buf).await?;

        Ok(buf)
    }
}

pub trait ClickhouseWrite: AsyncWrite + Unpin + Send + Sync + 'static {
    fn write_var_uint(&mut self, value: u64) -> impl Future<Output = Result<()>> + Send;

    fn write_string(
        &mut self,
        value: impl AsRef<[u8]> + Send,
    ) -> impl Future<Output = Result<()>> + Send;
}

impl<T: AsyncWrite + Unpin + Send + Sync + 'static> ClickhouseWrite for T {
    async fn write_var_uint(&mut self, mut value: u64) -> Result<()> {
        for _ in 0..9u64 {
            let mut byte = value & 0x7F;
            if value > 0x7F {
                byte |= 0x80;
            }
            self.write_all(&[byte as u8]).await?;
            value >>= 7;
            if value == 0 {
                break;
            }
        }
        Ok(())
    }

    async fn write_string(&mut self, value: impl AsRef<[u8]> + Send) -> Result<()> {
        let value = value.as_ref();
        self.write_var_uint(value.len() as u64).await?;
        self.write_all(value).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn utf8_string_escapes_invalid_bytes() {
        let mut input: &[u8] = &[5, 0xFF, b'a', 0xC3, 0xA9, 0xFE];
        assert_eq!(input.read_utf8_string().await.unwrap(), r"\xFFaé\xFE");
    }
}
