use std::{
    collections::{HashMap, VecDeque},
    str::FromStr,
};

use crate::Result;
use indexmap::IndexMap;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::{
    io::{ClickhouseRead, ClickhouseWrite},
    types::{DeserializerState, SerializerState, Type},
    values::Value,
    KlickhouseError,
};

/// Metadata about a block
#[derive(Debug, Clone)]
pub struct BlockInfo {
    pub is_overflows: bool,
    pub bucket_num: i32,
}

impl Default for BlockInfo {
    fn default() -> Self {
        BlockInfo {
            is_overflows: false,
            bucket_num: -1,
        }
    }
}

impl BlockInfo {
    async fn read<R: ClickhouseRead>(reader: &mut R) -> Result<Self> {
        let mut new = Self::default();
        loop {
            let field_num = reader.read_var_uint().await?;
            match field_num {
                0 => break,
                1 => {
                    new.is_overflows = reader.read_u8().await? != 0;
                }
                2 => {
                    new.bucket_num = reader.read_i32_le().await?;
                }
                field_num => {
                    return Err(KlickhouseError::ProtocolError(format!(
                        "unknown block info field number: {}",
                        field_num
                    )));
                }
            }
        }
        Ok(new)
    }

    async fn write<W: ClickhouseWrite>(&self, writer: &mut W) -> Result<()> {
        writer.write_var_uint(1).await?;
        writer
            .write_u8(if self.is_overflows { 1 } else { 2 })
            .await?;
        writer.write_var_uint(2).await?;
        writer.write_i32_le(self.bucket_num).await?;
        writer.write_var_uint(0).await?;
        Ok(())
    }
}

#[derive(Debug, Clone)]
/// A chunk of data in columnar form.
pub struct Block {
    /// Metadata about the block
    pub info: BlockInfo,
    /// The number of rows contained in the block
    pub rows: u64,
    /// The type of each column by name, in order.
    pub column_types: IndexMap<String, Type>,
    /// The data of each column by name, in order. All `Value` should correspond to the associated type in `column_types`.
    pub column_data: IndexMap<String, Vec<Value>>,
}

/// Iterator type for `iter_rows`
pub struct BlockRowIter<'a> {
    block: &'a Block,
    row: u64,
}

impl<'a> Iterator for BlockRowIter<'a> {
    type Item = Vec<(&'a str, &'a Value)>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.row >= self.block.rows {
            return None;
        }
        let mut out = Vec::new();
        for (name, value) in self.block.column_data.iter() {
            out.push((&**name, value.get(self.row as usize)?));
        }
        self.row += 1;
        Some(out)
    }
}

// Iterator type for `take_iter_rows`
pub struct BlockRowValueIter<'a> {
    column_data: Vec<(&'a str, &'a Type, std::vec::IntoIter<Value>)>,
}

impl<'a> Iterator for BlockRowValueIter<'a> {
    type Item = Vec<(&'a str, &'a Type, Value)>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.column_data.is_empty() {
            return None;
        }
        let mut out = Vec::new();
        for (name, type_, pop) in self.column_data.iter_mut() {
            out.push((*name, *type_, pop.next()?));
        }
        Some(out)
    }
}

/// Iterator type for `into_iter_rows`
pub struct BlockRowIntoIter {
    column_data: IndexMap<String, VecDeque<(Type, Value)>>,
}

impl Iterator for BlockRowIntoIter {
    type Item = IndexMap<String, (Type, Value)>;

    fn next(&mut self) -> Option<Self::Item> {
        let mut out = IndexMap::new();
        if self.column_data.is_empty() {
            return None;
        }
        for (name, value) in self.column_data.iter_mut() {
            out.insert(name.clone(), value.pop_front()?);
        }
        Some(out)
    }
}

// chgui patch: JSON columns arrive as strings after an 8-byte version prefix.
fn is_json_as_string_type(type_name: &str) -> bool {
    let t = type_name.trim();
    if t == "JSON" {
        return true;
    }
    if let Some(rest) = t.strip_prefix("JSON(") {
        if rest.ends_with(')') {
            return true;
        }
    }
    if let Some(rest) = t.strip_prefix("Object(") {
        if rest.ends_with(')') {
            return true;
        }
    }
    false
}

impl Block {
    /// Create a borrowing iterator for all rows
    pub fn iter_rows(&self) -> BlockRowIter<'_> {
        BlockRowIter {
            block: self,
            row: 0,
        }
    }

    /// Iterate over all rows with owned values.
    pub fn take_iter_rows(&mut self) -> BlockRowValueIter {
        let mut column_data = IndexMap::new();
        std::mem::swap(&mut self.column_data, &mut column_data);
        let mut out = Vec::with_capacity(column_data.len());
        for (name, values) in column_data.into_iter() {
            let (name, type_) = self.column_types.get_key_value(&name).unwrap();
            out.push((&**name, type_.strip_low_cardinality(), values.into_iter()));
        }
        BlockRowValueIter { column_data: out }
    }

    /// Iterate over all rows with owned value, types, and names.
    pub fn into_iter_rows(self) -> BlockRowIntoIter {
        let column_types = self.column_types;
        BlockRowIntoIter {
            column_data: self
                .column_data
                .into_iter()
                .map(|(name, values)| {
                    let type_ = column_types.get(&name).unwrap();
                    (
                        name,
                        values.into_iter().map(|x| (type_.clone(), x)).collect(),
                    )
                })
                .collect(),
        }
    }

    pub(crate) async fn read<R: ClickhouseRead>(reader: &mut R, revision: u64) -> Result<Self> {
        let info = if revision > 0 {
            BlockInfo::read(reader).await?
        } else {
            Default::default()
        };
        let columns = reader.read_var_uint().await?;
        let rows = reader.read_var_uint().await?;
        if columns == 0 && rows > 0 {
            return Err(KlickhouseError::ProtocolError(format!(
                "block has {rows} rows and no columns"
            )));
        }
        let mut block = Block {
            info,
            rows,
            column_types: IndexMap::new(),
            column_data: IndexMap::new(),
        };
        let mut next_suffix = HashMap::new();
        for _ in 0..columns {
            let name = reader.read_utf8_string().await?;
            let type_name = reader.read_utf8_string().await?;
            // chgui patch: skip the JSON serialization-version prefix; name the column in type errors.
            // With `output_format_native_write_json_as_string=1`, ClickHouse puts an 8-byte little-endian
            // version before the strings of a JSON column. If left unread, the String deserializer takes
            // those bytes as the first row's length and misparses the rest of the block.
            let is_json_as_string = is_json_as_string_type(&type_name);
            let type_ = Type::from_str(&type_name).map_err(|e| match e {
                KlickhouseError::TypeParseError(msg) => {
                    KlickhouseError::TypeParseError(format!("column '{name}': {msg}"))
                }
                e => e,
            })?;
            let name = unique_column_name(&block.column_types, &mut next_suffix, name);
            block.column_types.insert(name.clone(), type_.clone());
            let mut state = DeserializerState {};
            let row_data = if rows > 0 {
                if is_json_as_string {
                    let _serialization_version = reader.read_u64_le().await?;
                }
                type_.deserialize_prefix(reader, &mut state).await?;
                type_
                    .deserialize_column(reader, rows as usize, &mut state)
                    .await?
            } else {
                vec![]
            };
            block.column_data.insert(name, row_data);
        }

        Ok(block)
    }

    pub(crate) async fn write<W: ClickhouseWrite>(
        mut self,
        writer: &mut W,
        revision: u64,
    ) -> Result<()> {
        if revision > 0 {
            self.info.write(writer).await?;
        }
        let joined = self
            .column_types
            .into_iter()
            .flat_map(|(key, type_)| {
                let values = self.column_data.swap_remove(&key)?;
                Some((key, (type_, values)))
            })
            .collect::<Vec<_>>();
        writer.write_var_uint(joined.len() as u64).await?;
        writer.write_var_uint(self.rows).await?;
        for (name, (type_, data)) in joined {
            writer.write_string(&name).await?;
            writer.write_string(&type_.to_string()).await?;
            if data.len() != self.rows as usize {
                return Err(KlickhouseError::ProtocolError(format!(
                    "row and column length mismatch. {} != {}",
                    data.len(),
                    self.rows
                )));
            }
            if self.rows > 0 {
                let mut state = SerializerState {};
                type_.serialize_prefix(writer, &mut state).await?;
                type_.serialize_column(data, writer, &mut state).await?;
            }
        }
        Ok(())
    }
}

/// chgui patch: keep every column. ClickHouse sends repeated names (`SELECT 1, 1`), and the UTF-8
/// escaping in `read_utf8_string` can make two names equal. Both block maps key by name, so a
/// repeat would replace the earlier column. The repeat gets a suffix, as in `1 (2)`.
fn unique_column_name(
    taken: &IndexMap<String, Type>,
    next_suffix: &mut HashMap<String, usize>,
    name: String,
) -> String {
    if !taken.contains_key(&name) {
        return name;
    }
    let n = next_suffix.entry(name.clone()).or_insert(2);
    loop {
        let candidate = format!("{name} ({n})");
        *n += 1;
        if !taken.contains_key(&candidate) {
            return candidate;
        }
    }
}

// chgui patch: tests for the JSON prefix and aggregate-type decoding.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::ClickhouseWrite;
    use std::io::Cursor;

    #[tokio::test]
    async fn rows_without_columns_are_an_error() {
        let mut bytes: Vec<u8> = Vec::new();
        bytes.write_var_uint(0).await.unwrap();
        bytes.write_var_uint(1).await.unwrap();
        assert!(Block::read(&mut Cursor::new(bytes), 0).await.is_err());
    }

    #[test]
    fn take_iter_rows_reserves_per_column_not_per_row() {
        let mut block = Block {
            info: Default::default(),
            rows: 1 << 62,
            column_types: IndexMap::new(),
            column_data: IndexMap::new(),
        };
        assert!(block.take_iter_rows().next().is_none());
    }

    #[test]
    fn is_json_as_string_type_recognizes_variants() {
        assert!(is_json_as_string_type("JSON"));
        assert!(is_json_as_string_type("JSON(max_dynamic_paths=1024)"));
        assert!(is_json_as_string_type(
            "JSON(max_dynamic_paths=256, max_dynamic_types=16)"
        ));
        assert!(is_json_as_string_type("Object('json')"));
        assert!(is_json_as_string_type("Object('JSON')"));
        assert!(is_json_as_string_type("  JSON  "));

        assert!(!is_json_as_string_type("String"));
        assert!(!is_json_as_string_type("Nullable(JSON)"));
        assert!(!is_json_as_string_type("Array(JSON)"));
        assert!(!is_json_as_string_type("Map(String, JSON)"));
    }

    async fn encode_single_json_column_block(
        col_name: &str,
        rows: &[&str],
    ) -> Vec<u8> {
        let mut out: Vec<u8> = Vec::new();
        // Revision 0 sends no BlockInfo.
        out.write_var_uint(1).await.unwrap(); // columns
        out.write_var_uint(rows.len() as u64).await.unwrap(); // rows
        out.write_string(col_name).await.unwrap();
        out.write_string("JSON").await.unwrap();
        // 8-byte little-endian serialization version, where 1 means STRING.
        out.extend_from_slice(&1u64.to_le_bytes());
        for row in rows {
            out.write_string(row).await.unwrap();
        }
        out
    }

    #[tokio::test]
    async fn reads_json_column_as_string_values() {
        let bytes =
            encode_single_json_column_block("data", &[r#"{"a":1}"#, r#"{"b":2}"#, r#""#]).await;
        let mut cursor = Cursor::new(bytes);
        let block = Block::read(&mut cursor, 0).await.expect("Block::read");

        let (name, ty) = block.column_types.iter().next().unwrap();
        assert_eq!(name, "data");
        assert_eq!(*ty, Type::String);
        assert_eq!(block.rows, 3);

        let col = block.column_data.get("data").unwrap();
        let as_str = |v: &Value| match v {
            Value::String(b) => String::from_utf8(b.clone()).unwrap(),
            other => panic!("expected String, got {other:?}"),
        };
        assert_eq!(as_str(&col[0]), r#"{"a":1}"#);
        assert_eq!(as_str(&col[1]), r#"{"b":2}"#);
        assert_eq!(as_str(&col[2]), r#""#);
    }

    #[tokio::test]
    async fn json_column_does_not_desync_next_column() {
        let mut out: Vec<u8> = Vec::new();
        out.write_var_uint(2).await.unwrap(); // columns
        out.write_var_uint(1).await.unwrap(); // rows
        out.write_string("payload").await.unwrap();
        out.write_string("JSON").await.unwrap();
        out.extend_from_slice(&1u64.to_le_bytes());
        out.write_string(r#"{"k":"v"}"#).await.unwrap();
        out.write_string("name").await.unwrap();
        out.write_string("String").await.unwrap();
        out.write_string("alice").await.unwrap();

        let mut cursor = Cursor::new(out);
        let block = Block::read(&mut cursor, 0)
            .await
            .expect("Block::read should not desync");

        assert_eq!(block.rows, 1);
        assert_eq!(block.column_types.len(), 2);
        let types: Vec<_> = block.column_types.iter().collect();
        assert_eq!(types[0].0, "payload");
        assert_eq!(*types[0].1, Type::String);
        assert_eq!(types[1].0, "name");
        assert_eq!(*types[1].1, Type::String);

        let payload = block.column_data.get("payload").unwrap();
        let name = block.column_data.get("name").unwrap();
        match (&payload[0], &name[0]) {
            (Value::String(a), Value::String(b)) => {
                assert_eq!(String::from_utf8(a.clone()).unwrap(), r#"{"k":"v"}"#);
                assert_eq!(String::from_utf8(b.clone()).unwrap(), "alice");
            }
            other => panic!("unexpected values: {other:?}"),
        }
    }

    #[tokio::test]
    async fn empty_json_column_does_not_read_version_byte() {
        let mut out: Vec<u8> = Vec::new();
        out.write_var_uint(1).await.unwrap(); // columns
        out.write_var_uint(0).await.unwrap(); // rows=0
        out.write_string("data").await.unwrap();
        out.write_string("JSON").await.unwrap();
        // ClickHouse sends no version prefix for a zero-row block.

        let mut cursor = Cursor::new(out);
        let block = Block::read(&mut cursor, 0).await.expect("Block::read");

        assert_eq!(block.rows, 0);
        assert_eq!(
            *block.column_types.get("data").unwrap(),
            Type::String,
            "JSON column type should still resolve to String even with no rows"
        );
        assert!(block.column_data.get("data").unwrap().is_empty());
    }

    #[tokio::test]
    async fn simple_aggregate_function_column_decodes_as_inner_type() {
        let mut out: Vec<u8> = Vec::new();
        out.write_var_uint(1).await.unwrap(); // columns
        out.write_var_uint(2).await.unwrap(); // rows
        out.write_string("s").await.unwrap();
        out.write_string("SimpleAggregateFunction(sum, UInt64)")
            .await
            .unwrap();
        out.extend_from_slice(&7u64.to_le_bytes());
        out.extend_from_slice(&42u64.to_le_bytes());

        let mut cursor = Cursor::new(out);
        let block = Block::read(&mut cursor, 0).await.expect("Block::read");

        assert_eq!(*block.column_types.get("s").unwrap(), Type::UInt64);
        let col = block.column_data.get("s").unwrap();
        assert_eq!(col[0], Value::UInt64(7));
        assert_eq!(col[1], Value::UInt64(42));
    }

    #[tokio::test]
    async fn aggregate_function_column_errors_with_column_name() {
        let mut out: Vec<u8> = Vec::new();
        out.write_var_uint(1).await.unwrap(); // columns
        out.write_var_uint(0).await.unwrap(); // rows=0: type parse runs first
        out.write_string("st").await.unwrap();
        out.write_string("AggregateFunction(quantiles(0.5), Float64)")
            .await
            .unwrap();

        let mut cursor = Cursor::new(out);
        let err = Block::read(&mut cursor, 0).await.unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("column 'st'"), "missing column name: {msg}");
        assert!(
            msg.contains("finalizeAggregation"),
            "missing finalizeAggregation hint: {msg}"
        );
    }

    #[tokio::test]
    async fn repeated_column_names_keep_every_column() {
        let mut out: Vec<u8> = Vec::new();
        out.write_var_uint(3).await.unwrap(); // columns
        out.write_var_uint(1).await.unwrap(); // rows
        for (name, value) in [("1", 7u8), ("1", 8), ("1 (2)", 9)] {
            out.write_string(name).await.unwrap();
            out.write_string("UInt8").await.unwrap();
            out.push(value);
        }
        let block = Block::read(&mut &out[..], 0).await.unwrap();
        let names: Vec<_> = block.column_types.keys().map(String::as_str).collect();
        assert_eq!(names, ["1", "1 (2)", "1 (2) (2)"]);
        let values: Vec<_> = block.column_data.values().map(|c| c[0].clone()).collect();
        assert_eq!(values, [Value::UInt8(7), Value::UInt8(8), Value::UInt8(9)]);
    }

    #[tokio::test]
    async fn many_equal_column_names_decode_in_linear_time() {
        const COLUMNS: u64 = 40_000;
        let mut out: Vec<u8> = Vec::new();
        out.write_var_uint(COLUMNS).await.unwrap();
        out.write_var_uint(0).await.unwrap(); // rows
        for _ in 0..COLUMNS {
            out.write_string("").await.unwrap();
            out.write_string("UInt8").await.unwrap();
        }
        let started = std::time::Instant::now();
        let block = Block::read(&mut &out[..], 0).await.unwrap();
        assert_eq!(block.column_types.len() as u64, COLUMNS);
        assert_eq!(block.column_types.keys().last().unwrap(), " (40000)");
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
    }
}
