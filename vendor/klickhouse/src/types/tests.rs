use std::io::Cursor;
use std::str::FromStr;

use crate::Result;
use crate::{
    i256,
    types::{DeserializerState, SerializerState},
    u256,
    values::{self, Value},
    Date, DateTime, DynDateTime64,
};
use crate::protocol::MAX_PREALLOC_ROWS;
use uuid::Uuid;

use super::deserialize::{sized::SizedDeserializer, string::StringDeserializer};
use super::{Deserializer, Type};

// chgui patch: regression tests for the JSON and aggregate-type parsing patches.

#[test]
fn json_type_parses_as_string_alias() {
    assert_eq!(Type::from_str("JSON").unwrap(), Type::String);
}

#[test]
fn json_with_args_parses_as_string_alias() {
    assert_eq!(
        Type::from_str("JSON(max_dynamic_paths=1024)").unwrap(),
        Type::String,
    );
    assert_eq!(
        Type::from_str("JSON(max_dynamic_paths=256, max_dynamic_types=16)").unwrap(),
        Type::String,
    );
}

#[test]
fn object_json_parses_as_string_alias() {
    assert_eq!(Type::from_str("Object('json')").unwrap(), Type::String);
}

#[test]
fn json_nested_in_another_type_is_an_error() {
    for t in ["Array(JSON)", "Nullable(JSON)", "Tuple(a JSON(max_dynamic_paths=1))"] {
        assert!(Type::from_str(t).is_err(), "{t}");
    }
}

#[test]
fn scale_and_precision_past_their_limits_are_errors() {
    assert_eq!(
        Type::from_str("Decimal256(76)").unwrap(),
        Type::Decimal256(76)
    );
    assert!(Type::from_str("Decimal256(77)").is_err());
    assert!(Type::from_str("DateTime64(10)").is_err());
    assert!(Type::from_str("DateTime(')").is_err());
    assert!(Type::from_str("DateTime64(3, ')").is_err());
    assert_eq!(
        Type::from_str("FixedString(100)").unwrap(),
        Type::FixedString(100)
    );
}

#[test]
fn simple_aggregate_function_parses_as_inner_type() {
    assert_eq!(
        Type::from_str("SimpleAggregateFunction(sum, UInt64)").unwrap(),
        Type::UInt64,
    );
    assert_eq!(
        Type::from_str("SimpleAggregateFunction(anyLast, Nullable(String))").unwrap(),
        Type::Nullable(Box::new(Type::String)),
    );
    assert_eq!(
        Type::from_str("SimpleAggregateFunction(sum, Decimal(18, 4))").unwrap(),
        Type::Decimal64(4),
    );
    assert_eq!(
        Type::from_str("Array(SimpleAggregateFunction(groupBitOr, UInt32))").unwrap(),
        Type::Array(Box::new(Type::UInt32)),
    );
}

#[test]
fn simple_aggregate_function_bad_arity_errors() {
    assert!(Type::from_str("SimpleAggregateFunction(sum)").is_err());
}

#[test]
fn aggregate_function_yields_friendly_error() {
    for s in [
        "AggregateFunction(count)",
        "AggregateFunction(quantiles(0.5, 0.9), Float64)",
        "Nullable(AggregateFunction(uniq, String))",
    ] {
        let err = Type::from_str(s).unwrap_err();
        assert!(
            err.to_string().contains("finalizeAggregation"),
            "expected finalizeAggregation hint for '{s}', got: {err}"
        );
    }
}

async fn roundtrip_values(type_: &Type, values: &[Value]) -> Result<Vec<Value>> {
    let mut output = vec![];

    let mut state = SerializerState {};
    type_.serialize_prefix(&mut output, &mut state).await?;
    type_
        .serialize_column(values.to_vec(), &mut output, &mut state)
        .await?;
    for x in &output {
        print!("{x:02X}");
    }
    println!();
    let mut input = Cursor::new(output);
    let mut state = DeserializerState {};
    type_.deserialize_prefix(&mut input, &mut state).await?;
    let deserialized = type_
        .deserialize_column(&mut input, values.len(), &mut state)
        .await?;

    Ok(deserialized)
}

#[tokio::test]
async fn roundtrip_u8() {
    let values = &[Value::UInt8(12), Value::UInt8(24), Value::UInt8(30)];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::UInt8, &values[..]).await.unwrap()
    );
}

#[tokio::test]
async fn roundtrip_u16() {
    let values = &[Value::UInt16(12), Value::UInt16(24), Value::UInt16(30000)];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::UInt16, &values[..]).await.unwrap()
    );
}

#[tokio::test]
async fn roundtrip_u32() {
    let values = &[Value::UInt32(12), Value::UInt32(24), Value::UInt32(900000)];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::UInt32, &values[..]).await.unwrap()
    );
}

#[tokio::test]
async fn roundtrip_u64() {
    let values = &[
        Value::UInt64(12),
        Value::UInt64(24),
        Value::UInt64(9000000000),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::UInt64, &values[..]).await.unwrap()
    );
}

#[tokio::test]
async fn roundtrip_u128() {
    let values = &[
        Value::UInt128(12),
        Value::UInt128(24),
        Value::UInt128(9000000000),
        Value::UInt128(9000000000u128 * 9000000000),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::UInt128, &values[..]).await.unwrap()
    );
}

#[tokio::test]
async fn roundtrip_u256() {
    let values = &[
        Value::UInt256(u256([0u8; 32])),
        Value::UInt256(u256([7u8; 32])),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::UInt256, &values[..]).await.unwrap()
    );
}

#[tokio::test]
async fn roundtrip_i8() {
    let values = &[
        Value::Int8(12),
        Value::Int8(24),
        Value::Int8(30),
        Value::Int8(-30),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::Int8, &values[..]).await.unwrap()
    );
}

#[tokio::test]
async fn roundtrip_i16() {
    let values = &[
        Value::Int16(12),
        Value::Int16(24),
        Value::Int16(30000),
        Value::Int16(-30000),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::Int16, &values[..]).await.unwrap()
    );
}

#[tokio::test]
async fn roundtrip_i32() {
    let values = &[
        Value::Int32(12),
        Value::Int32(24),
        Value::Int32(900000),
        Value::Int32(-900000),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::Int32, &values[..]).await.unwrap()
    );
}

#[tokio::test]
async fn roundtrip_i64() {
    let values = &[
        Value::Int64(12),
        Value::Int64(24),
        Value::Int64(9000000000),
        Value::Int64(-9000000000),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::Int64, &values[..]).await.unwrap()
    );
}

#[tokio::test]
async fn roundtrip_i128() {
    let values = &[
        Value::Int128(12),
        Value::Int128(24),
        Value::Int128(9000000000),
        Value::Int128(9000000000i128 * 9000000000),
        Value::Int128(-9000000000i128 * 9000000000),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::Int128, &values[..]).await.unwrap()
    );
}

#[tokio::test]
async fn roundtrip_i256() {
    let values = &[
        Value::Int256(i256([0u8; 32])),
        Value::Int256(i256([7u8; 32])),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::Int256, &values[..]).await.unwrap()
    );
}

#[tokio::test]
async fn roundtrip_f32() {
    let values = &[
        Value::Float32(1.0_f32),
        Value::Float32(0.0_f32),
        Value::Float32(100.0_f32),
        Value::Float32(100000.0_f32),
        Value::Float32(1000000.0_f32),
        Value::Float32(-1000000.0_f32),
        Value::Float32(f32::NAN),
        Value::Float32(f32::INFINITY),
        Value::Float32(f32::NEG_INFINITY),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::Float32, &values[..]).await.unwrap()
    );
}

#[tokio::test]
async fn roundtrip_f64() {
    let values = &[
        Value::Float64(1.0_f64),
        Value::Float64(0.0_f64),
        Value::Float64(100.0_f64),
        Value::Float64(100000.0_f64),
        Value::Float64(1000000.0_f64),
        Value::Float64(-1000000.0_f64),
        Value::Float64(f64::NAN),
        Value::Float64(f64::INFINITY),
        Value::Float64(f64::NEG_INFINITY),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::Float64, &values[..]).await.unwrap()
    );
}

#[tokio::test]
async fn roundtrip_d32() {
    let values = &[
        Value::Decimal32(5, 12),
        Value::Decimal32(5, 24),
        Value::Decimal32(5, 900000),
        Value::Decimal32(5, -900000),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::Decimal32(5), &values[..])
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn roundtrip_d64() {
    let values = &[
        Value::Decimal64(5, 12),
        Value::Decimal64(5, 24),
        Value::Decimal64(5, 9000000000),
        Value::Decimal64(5, -9000000000),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::Decimal64(5), &values[..])
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn roundtrip_d128() {
    let values = &[
        Value::Decimal128(5, 12),
        Value::Decimal128(5, 24),
        Value::Decimal128(5, 9000000000),
        Value::Decimal128(5, 9000000000i128 * 9000000000),
        Value::Decimal128(5, -9000000000i128 * 9000000000),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::Decimal128(5), &values[..])
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn roundtrip_d256() {
    let values = &[
        Value::Decimal256(5, i256([0u8; 32])),
        Value::Decimal256(5, i256([7u8; 32])),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::Decimal256(5), &values[..])
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn roundtrip_null_int() {
    let values = &[
        Value::UInt32(35),
        Value::UInt32(90),
        Value::Null,
        Value::UInt32(120),
        Value::UInt32(10000),
        Value::Null,
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::Nullable(Box::new(Type::UInt32)), &values[..])
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn roundtrip_string() {
    let values = &[
        Value::string(""),
        Value::string("t"),
        Value::string("test"),
        Value::string("TESTST"),
        Value::string("日本語"),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::String, &values[..]).await.unwrap()
    );
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::FixedString(32), &values[..])
            .await
            .unwrap()
    );
    assert_ne!(
        &values[..],
        roundtrip_values(&Type::FixedString(3), &values[..])
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn roundtrip_null_string() {
    let values = &[
        Value::string(""),
        Value::Null,
        Value::string("t"),
        Value::string("test"),
        Value::Null,
        Value::string("TESTST"),
        Value::string("日本語"),
        Value::Null,
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::Nullable(Box::new(Type::String)), &values[..])
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn roundtrip_uuid() {
    let values = &[
        Value::Uuid(Uuid::from_u128(0)),
        Value::Uuid(Uuid::from_u128(1)),
        Value::Uuid(Uuid::from_u128(456345634563456)),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::Uuid, &values[..]).await.unwrap()
    );
}

#[tokio::test]
async fn roundtrip_date() {
    let values = &[
        Value::Date(Date(0)),
        Value::Date(Date(3234)),
        Value::Date(Date(45345)),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::Date, &values[..]).await.unwrap()
    );
}

#[tokio::test]
async fn roundtrip_datetime() {
    let values = &[
        Value::DateTime(DateTime(chrono_tz::UTC, 0)),
        Value::DateTime(DateTime(chrono_tz::UTC, 323463434)),
        Value::DateTime(DateTime(chrono_tz::UTC, 45345345)),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::DateTime(chrono_tz::UTC), &values[..])
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn roundtrip_datetime64() {
    let values = &[
        Value::DateTime64(DynDateTime64(chrono_tz::UTC, 0, 3)),
        Value::DateTime64(DynDateTime64(chrono_tz::UTC, 32346345634, 3)),
        Value::DateTime64(DynDateTime64(chrono_tz::UTC, 4534564345, 3)),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::DateTime64(3, chrono_tz::UTC), &values[..])
            .await
            .unwrap()
    );
}

//enum8, enum16, nested skipped

#[tokio::test]
async fn roundtrip_array() {
    let values = &[
        Value::Array(vec![]),
        Value::Array(vec![Value::UInt32(0)]),
        Value::Array(vec![Value::UInt32(1), Value::UInt32(2), Value::UInt32(3)]),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::Array(Box::new(Type::UInt32)), &values[..])
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn roundtrip_array2() {
    let values = &[
        Value::Array(vec![Value::Array(vec![])]),
        Value::Array(vec![Value::Array(vec![Value::UInt32(1)])]),
        Value::Array(vec![
            Value::Array(vec![Value::UInt32(2)]),
            Value::Array(vec![Value::UInt32(3)]),
        ]),
        Value::Array(vec![
            Value::Array(vec![Value::UInt32(4), Value::UInt32(5)]),
            Value::Array(vec![Value::UInt32(6), Value::UInt32(7)]),
        ]),
        Value::Array(vec![Value::Array(vec![Value::UInt32(8)])]),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(
            &Type::Array(Box::new(Type::Array(Box::new(Type::UInt32)))),
            &values[..]
        )
        .await
        .unwrap()
    );
}

#[tokio::test]
async fn roundtrip_tuple() {
    let values = &[
        Value::Tuple(vec![Value::UInt32(1), Value::UInt16(2)]),
        Value::Tuple(vec![Value::UInt32(3), Value::UInt16(4)]),
        Value::Tuple(vec![Value::UInt32(4), Value::UInt16(5)]),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::Tuple(vec![Type::UInt32, Type::UInt16]), &values[..])
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn roundtrip_2tuple() {
    let values = &[
        Value::Tuple(vec![
            Value::UInt32(1),
            Value::Tuple(vec![Value::UInt32(1), Value::UInt16(2)]),
        ]),
        Value::Tuple(vec![
            Value::UInt32(3),
            Value::Tuple(vec![Value::UInt32(3), Value::UInt16(4)]),
        ]),
        Value::Tuple(vec![
            Value::UInt32(4),
            Value::Tuple(vec![Value::UInt32(4), Value::UInt16(5)]),
        ]),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(
            &Type::Tuple(vec![
                Type::UInt32,
                Type::Tuple(vec![Type::UInt32, Type::UInt16])
            ]),
            &values[..]
        )
        .await
        .unwrap()
    );
}

#[tokio::test]
async fn roundtrip_array_tuple() {
    let values = &[
        Value::Array(vec![
            Value::Tuple(vec![Value::UInt32(1), Value::UInt16(2)]),
            Value::Tuple(vec![Value::UInt32(3), Value::UInt16(4)]),
        ]),
        Value::Array(vec![Value::Tuple(vec![Value::UInt32(5), Value::UInt16(6)])]),
        Value::Array(vec![]),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(
            &Type::Array(Box::new(Type::Tuple(vec![Type::UInt32, Type::UInt16]))),
            &values[..]
        )
        .await
        .unwrap()
    );
}

#[tokio::test]
async fn roundtrip_tuple_array() {
    let values = &[
        Value::Tuple(vec![Value::Array(vec![]), Value::Array(vec![])]),
        Value::Tuple(vec![
            Value::Array(vec![Value::UInt32(1)]),
            Value::Array(vec![]),
        ]),
        Value::Tuple(vec![
            Value::Array(vec![]),
            Value::Array(vec![Value::UInt16(2)]),
        ]),
        Value::Tuple(vec![
            Value::Array(vec![Value::UInt32(3)]),
            Value::Array(vec![Value::UInt16(4)]),
        ]),
        Value::Tuple(vec![
            Value::Array(vec![Value::UInt32(5), Value::UInt32(6)]),
            Value::Array(vec![Value::UInt16(7), Value::UInt16(8)]),
        ]),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(
            &Type::Tuple(vec![
                Type::Array(Box::new(Type::UInt32)),
                Type::Array(Box::new(Type::UInt16))
            ]),
            &values[..]
        )
        .await
        .unwrap()
    );
}

#[tokio::test]
async fn roundtrip_array_nulls() {
    let values = &[
        Value::Array(vec![]),
        Value::Array(vec![Value::Null]),
        Value::Array(vec![Value::UInt32(0), Value::Null]),
        Value::Array(vec![Value::Null, Value::UInt32(0)]),
        Value::Array(vec![
            Value::Null,
            Value::Null,
            Value::UInt32(1),
            Value::UInt32(2),
            Value::Null,
            Value::UInt32(3),
        ]),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(
            &Type::Array(Box::new(Type::Nullable(Box::new(Type::UInt32)))),
            &values[..]
        )
        .await
        .unwrap()
    );
}

#[tokio::test]
async fn roundtrip_map() {
    let values = &[
        Value::Map(vec![], vec![]),
        Value::Map(vec![Value::UInt32(1)], vec![Value::UInt16(2)]),
        Value::Map(
            vec![Value::UInt32(5), Value::UInt32(3)],
            vec![Value::UInt16(6), Value::UInt16(4)],
        ),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(
            &Type::Map(Box::new(Type::UInt32), Box::new(Type::UInt16)),
            &values[..]
        )
        .await
        .unwrap()
    );
}

#[tokio::test]
async fn roundtrip_low_cardinality_string() {
    let values = &[
        Value::string(""),
        Value::string("abc"),
        Value::string("abc"),
        Value::string("bcd"),
        Value::string("bcd2"),
        Value::string("abc"),
        Value::string("abc"),
        Value::string("abc"),
        Value::string("abc"),
        Value::string("abc"),
        Value::string("abc"),
        Value::string("abc"),
        Value::string("abc"),
        Value::string("abc"),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::LowCardinality(Box::new(Type::String)), &values[..])
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn roundtrip_low_cardinality_string_array() {
    let values = &[
        Value::Array(vec![]),
        Value::Array(vec![Value::string("")]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("bcd")]),
        Value::Array(vec![Value::string("bcd2")]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("abc")]),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(
            &Type::Array(Box::new(Type::LowCardinality(Box::new(Type::String)))),
            &values[..]
        )
        .await
        .unwrap()
    );
}

#[tokio::test]
async fn roundtrip_low_cardinality_string_map() {
    let values = &[
        Value::Map(vec![Value::string("")], vec![Value::UInt32(1)]),
        Value::Map(vec![Value::string("abc")], vec![Value::UInt32(1)]),
        Value::Map(vec![Value::string("abc")], vec![Value::UInt32(1)]),
        Value::Map(vec![Value::string("bcd")], vec![Value::UInt32(1)]),
        Value::Map(vec![Value::string("bcd2")], vec![Value::UInt32(1)]),
        Value::Map(vec![Value::string("abc")], vec![Value::UInt32(1)]),
        Value::Map(vec![Value::string("abc")], vec![Value::UInt32(1)]),
        Value::Map(vec![Value::string("abc")], vec![Value::UInt32(1)]),
        Value::Map(vec![Value::string("abc")], vec![Value::UInt32(1)]),
        Value::Map(vec![Value::string("abc")], vec![Value::UInt32(1)]),
        Value::Map(vec![Value::string("abc")], vec![Value::UInt32(1)]),
        Value::Map(vec![Value::string("abc")], vec![Value::UInt32(1)]),
        Value::Map(vec![Value::string("abc")], vec![Value::UInt32(1)]),
        Value::Map(vec![Value::string("abc")], vec![Value::UInt32(1)]),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(
            &Type::Map(
                Box::new(Type::LowCardinality(Box::new(Type::String))),
                Box::new(Type::UInt32)
            ),
            &values[..]
        )
        .await
        .unwrap()
    );
}

#[tokio::test]
async fn roundtrip_low_cardinality_string_null() {
    let values = &[
        Value::string(""),
        Value::Null,
        Value::string("abc"),
        Value::string("abc"),
        Value::string("bcd"),
        Value::string("bcd2"),
        Value::Null,
        Value::string("abc"),
        Value::string("abc"),
        Value::string("abc"),
        Value::string("abc"),
        Value::Null,
        Value::string("abc"),
        Value::string("abc"),
        Value::string("abc"),
        Value::string("abc"),
        Value::Null,
        Value::string("abc"),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(
            &Type::LowCardinality(Box::new(Type::Nullable(Box::new(Type::String)))),
            &values[..]
        )
        .await
        .unwrap()
    );
}

#[tokio::test]
async fn roundtrip_low_cardinality_array_null() {
    let values = &[
        Value::Array(vec![Value::string("")]),
        Value::Array(vec![Value::Null]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("bcd")]),
        Value::Array(vec![Value::string("bcd2")]),
        Value::Array(vec![Value::Null]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::Null]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::Null]),
        Value::Array(vec![Value::string("abc")]),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(
            &Type::Array(Box::new(Type::LowCardinality(Box::new(Type::Nullable(
                Box::new(Type::String)
            ))))),
            &values[..]
        )
        .await
        .unwrap()
    );
}

#[tokio::test]
async fn roundtrip_array_null() {
    let values = &[
        Value::Array(vec![Value::string("")]),
        Value::Array(vec![Value::Null]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("bcd")]),
        Value::Array(vec![Value::string("bcd2")]),
        Value::Array(vec![Value::Null]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::Null]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::string("abc")]),
        Value::Array(vec![Value::Null]),
        Value::Array(vec![Value::string("abc")]),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(
            &Type::Array(Box::new(Type::Nullable(Box::new(Type::String)))),
            &values[..]
        )
        .await
        .unwrap()
    );
}

#[tokio::test]
async fn roundtrip_geo() {
    // Points
    let point = |x| values::Point([x, x + 2.0]);
    let values = &[Value::Point(point(1.0)), Value::Point(point(3.0))];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::Point, &values[..]).await.unwrap()
    );
    // Ring
    let ring = |x| values::Ring(vec![point(x), point(2.0 * x)]);
    let values = &[Value::Ring(ring(1.0)), Value::Ring(ring(3.0))];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::Ring, &values[..]).await.unwrap()
    );
    // Polygon
    let polygon = |x| values::Polygon(vec![ring(x), ring(2.0 * x)]);
    let values = &[Value::Polygon(polygon(1.0)), Value::Polygon(polygon(3.0))];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::Polygon, &values[..]).await.unwrap()
    );
    // Multipolygon
    let multipolygon = |x| values::MultiPolygon(vec![polygon(x), polygon(2.0 * x)]);
    let values = &[
        Value::MultiPolygon(multipolygon(1.0)),
        Value::MultiPolygon(multipolygon(3.0)),
    ];
    assert_eq!(
        &values[..],
        roundtrip_values(&Type::MultiPolygon, &values[..])
            .await
            .unwrap()
    );
}

// chgui patch: named tuple field names parse and are dropped.
#[test]
fn parse_named_tuple_types() {
    use std::str::FromStr;
    assert_eq!(
        Type::from_str("Tuple(x String, y LowCardinality(String))").unwrap(),
        Type::Tuple(vec![Type::String, Type::LowCardinality(Box::new(Type::String))])
    );
    assert_eq!(
        Type::from_str("Tuple(`a\\`b` UInt8)").unwrap(),
        Type::Tuple(vec![Type::UInt8])
    );
    assert_eq!(
        Type::from_str("Tuple(`my field` UInt8, count Nullable(Int32))").unwrap(),
        Type::Tuple(vec![Type::UInt8, Type::Nullable(Box::new(Type::Int32))])
    );
    assert_eq!(
        Type::from_str("Array(Tuple(name LowCardinality(String), items Array(Tuple(k String, v String))))")
            .unwrap(),
        Type::Array(Box::new(Type::Tuple(vec![
            Type::LowCardinality(Box::new(Type::String)),
            Type::Array(Box::new(Type::Tuple(vec![Type::String, Type::String]))),
        ])))
    );
    assert_eq!(
        Type::from_str("Tuple(String, UInt8)").unwrap(),
        Type::Tuple(vec![Type::String, Type::UInt8])
    );
}

// chgui patch: Enum8 / Enum16 type strings parse into their entries.
#[test]
fn parse_enum_types() {
    use std::str::FromStr;
    assert_eq!(
        Type::from_str("Enum8('Normal' = 0, 'Aggregate' = 1)").unwrap(),
        Type::Enum8(vec![("Normal".into(), 0), ("Aggregate".into(), 1)])
    );
    assert_eq!(
        Type::from_str("Enum16('a, b' = -1, 'it\\'s (x)' = 300, 'q''q' = 7)").unwrap(),
        Type::Enum16(vec![("a, b".into(), -1), ("it's (x)".into(), 300), ("q'q".into(), 7)])
    );
    assert_eq!(
        Type::from_str("Nullable(Enum8('OFF' = 0, 'ON' = 1))").unwrap(),
        Type::Nullable(Box::new(Type::Enum8(vec![("OFF".into(), 0), ("ON".into(), 1)])))
    );
    assert!(Type::from_str("Enum8('x' = 300)").is_err());
    assert!(Type::from_str("Enum8(x = 1)").is_err());
    assert_eq!(
        Type::from_str("Array(Nullable(Enum8('a, (b' = 1, 'c)' = 2)))").unwrap(),
        Type::Array(Box::new(Type::Nullable(Box::new(Type::Enum8(vec![
            ("a, (b".into(), 1),
            ("c)".into(), 2)
        ])))))
    );
    assert!(Type::from_str("Array(String))").is_err());
    let t = Type::from_str("Enum8('a\\nb' = 1, 'it\\'s' = 2)").unwrap();
    assert_eq!(t, Type::Enum8(vec![("a\nb".into(), 1), ("it's".into(), 2)]));
    assert_eq!(
        Type::from_str("Enum8('Normal' = 0, 'Aggregate' = 1)").unwrap().to_string(),
        "Enum8('Normal' = 0, 'Aggregate' = 1)"
    );
}

async fn read_column(type_: &str, rows: usize, bytes: &[u8]) -> Result<Vec<Value>> {
    let mut reader = bytes;
    Type::from_str(type_)?
        .deserialize_column(&mut reader, rows, &mut DeserializerState {})
        .await
}

#[tokio::test]
async fn fixed_string_size_outside_the_limits_is_an_error() {
    for n in [0, usize::MAX] {
        assert!(Type::FixedString(n)
            .deserialize_column(&mut &[][..], 1, &mut DeserializerState {})
            .await
            .is_err());
    }
}

#[tokio::test]
async fn a_huge_row_count_does_not_reserve_memory_before_data_arrives() {
    let mut state = DeserializerState {};
    assert!(
        SizedDeserializer::read(&Type::UInt8, &mut &[][..], usize::MAX, &mut state)
            .await
            .is_err()
    );
    assert!(
        StringDeserializer::read(&Type::String, &mut &[][..], usize::MAX, &mut state)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn empty_tuple_rows_decode_up_to_the_cap() {
    assert_eq!(
        read_column("Tuple()", 2, &[]).await.unwrap(),
        vec![Value::Tuple(vec![]), Value::Tuple(vec![])]
    );
    assert!(read_column("Tuple()", MAX_PREALLOC_ROWS + 1, &[])
        .await
        .is_err());
}

#[tokio::test]
async fn type_nesting_past_the_limit_is_an_error() {
    let nested = |depth: usize| format!("{}UInt8{}", "Array(".repeat(depth), ")".repeat(depth));
    let mut bytes = 1u64.to_le_bytes().repeat(64);
    bytes.push(7);
    assert!(read_column(&nested(64), 1, &bytes).await.is_ok());
    assert!(Type::from_str(&nested(65)).is_err());
}

#[tokio::test]
async fn low_cardinality_with_no_dictionary_is_an_error() {
    let mut bytes = vec![];
    bytes.extend(0u64.to_le_bytes());
    bytes.extend(1u64.to_le_bytes());
    bytes.push(0);
    assert!(read_column("LowCardinality(String)", 1, &bytes)
        .await
        .is_err());
}

#[tokio::test]
async fn decreasing_array_offsets_are_an_error() {
    let mut bytes = vec![];
    bytes.extend(2u64.to_le_bytes());
    bytes.extend(1u64.to_le_bytes());
    bytes.push(7);
    assert!(read_column("Array(UInt8)", 2, &bytes).await.is_err());
}

#[tokio::test]
async fn decreasing_map_offsets_are_an_error() {
    let mut bytes = vec![];
    bytes.extend(2u64.to_le_bytes());
    bytes.extend(1u64.to_le_bytes());
    bytes.extend([7, 8]);
    assert!(read_column("Map(UInt8, UInt8)", 2, &bytes).await.is_err());
}

#[tokio::test]
async fn point_and_tuple_rows_keep_their_column_order() {
    let mut point = vec![];
    for v in [1.0f64, 2.0, 3.0, 4.0] {
        point.extend(v.to_le_bytes());
    }
    assert_eq!(
        read_column("Point", 2, &point).await.unwrap(),
        vec![
            Value::Point(values::Point([1.0, 3.0])),
            Value::Point(values::Point([2.0, 4.0])),
        ]
    );
    assert_eq!(
        read_column("Tuple(UInt8, UInt8)", 2, &[1, 2, 3, 4]).await.unwrap(),
        vec![
            Value::Tuple(vec![Value::UInt8(1), Value::UInt8(3)]),
            Value::Tuple(vec![Value::UInt8(2), Value::UInt8(4)]),
        ]
    );
}
