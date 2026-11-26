use tokio::io::AsyncReadExt;

use crate::{
    io::ClickhouseRead,
    protocol::{MAX_PREALLOC_ROWS, MAX_STRING_SIZE},
    values::Value,
    KlickhouseError, Result,
};

use super::{Deserializer, DeserializerState, Type};

pub struct StringDeserializer;

impl Deserializer for StringDeserializer {
    async fn read<R: ClickhouseRead>(
        type_: &Type,
        reader: &mut R,
        rows: usize,
        _state: &mut DeserializerState,
    ) -> Result<Vec<Value>> {
        match type_ {
            Type::String => {
                let mut out = Vec::with_capacity(rows.min(MAX_PREALLOC_ROWS));
                for _ in 0..rows {
                    out.push(Value::String(reader.read_string().await?));
                }
                Ok(out)
            }
            Type::FixedString(n) => {
                if *n == 0 || *n > MAX_STRING_SIZE {
                    return Err(KlickhouseError::ProtocolError(format!(
                        "FixedString size out of range: {} (limit {})",
                        n, MAX_STRING_SIZE
                    )));
                }
                let mut out = Vec::with_capacity(rows.min(MAX_PREALLOC_ROWS));
                for _ in 0..rows {
                    let mut buf = vec![0u8; *n];
                    reader.read_exact(&mut buf[..]).await?;
                    let first_null = buf.iter().position(|x| *x == 0).unwrap_or(buf.len());
                    buf.truncate(first_null);
                    out.push(Value::String(buf));
                }
                Ok(out)
            }
            _ => unimplemented!(),
        }
    }
}
