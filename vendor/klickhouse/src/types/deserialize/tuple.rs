use crate::{
    io::ClickhouseRead, protocol::MAX_PREALLOC_ROWS, values::Value, KlickhouseError, Result,
};

use super::{Deserializer, DeserializerState, Type};

pub struct TupleDeserializer;

impl Deserializer for TupleDeserializer {
    async fn read_prefix<R: ClickhouseRead>(
        type_: &Type,
        reader: &mut R,
        state: &mut DeserializerState,
    ) -> Result<()> {
        match type_ {
            Type::Tuple(inner) => {
                for item in inner {
                    item.deserialize_prefix(reader, state).await?;
                }
            }
            _ => unimplemented!(),
        }
        Ok(())
    }

    async fn read<R: ClickhouseRead>(
        type_: &Type,
        reader: &mut R,
        rows: usize,
        state: &mut DeserializerState,
    ) -> Result<Vec<Value>> {
        let types = type_.unwrap_tuple();
        // chgui patch: `SELECT tuple()` is valid, so reject only counts that no data bytes back.
        if types.is_empty() && rows > MAX_PREALLOC_ROWS {
            return Err(KlickhouseError::ProtocolError(format!(
                "empty Tuple has too many rows: {} > {}",
                rows, MAX_PREALLOC_ROWS
            )));
        }
        let mut columns = Vec::with_capacity(types.len());
        for type_ in types {
            columns.push(
                type_
                    .deserialize_column(reader, rows, state)
                    .await?
                    .into_iter(),
            );
        }
        Ok((0..rows)
            .map(|_| Value::Tuple(columns.iter_mut().filter_map(Iterator::next).collect()))
            .collect())
    }
}
