use serde::Serialize;

use klickhouse::{Type, Tz, Value};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "t", content = "v")]
pub enum CellValue {
    Null,
    Int(i64),
    Float(f64),
    BigInt(String),
    Decimal(String),
    Str(String),
    DateTime(String),
    Other(String),
}

/// Above this value a JS Number loses integer precision, so the frontend gets a string.
const SAFE_INT_MAX: i64 = 9_007_199_254_740_992;

pub fn convert_typed(value: &Value, ty: &Type) -> CellValue {
    let inner = peel(ty);
    if is_composite(value) {
        return CellValue::Other(render_composite(value, Some(inner)));
    }
    let label = match (inner, value) {
        (Type::Enum8(e), Value::Enum8(i)) => e.iter().find(|(_, v)| v == i).map(|(n, _)| n),
        (Type::Enum16(e), Value::Enum16(i)) => e.iter().find(|(_, v)| v == i).map(|(n, _)| n),
        _ => None,
    };
    match label {
        Some(n) => CellValue::Str(n.clone()),
        None => convert(value),
    }
}

pub fn convert(value: &Value) -> CellValue {
    use Value as V;
    match value {
        V::Null => CellValue::Null,
        V::Int8(n) => CellValue::Int(*n as i64),
        V::Int16(n) => CellValue::Int(*n as i64),
        V::Int32(n) => CellValue::Int(*n as i64),
        V::UInt8(n) => CellValue::Int(*n as i64),
        V::UInt16(n) => CellValue::Int(*n as i64),
        V::UInt32(n) => CellValue::Int(*n as i64),
        V::Int64(n) => {
            if n.unsigned_abs() <= SAFE_INT_MAX as u64 {
                CellValue::Int(*n)
            } else {
                CellValue::BigInt(n.to_string())
            }
        }
        V::UInt64(n) => {
            if *n <= SAFE_INT_MAX as u64 {
                CellValue::Int(*n as i64)
            } else {
                CellValue::BigInt(n.to_string())
            }
        }
        V::Int128(n) => CellValue::BigInt(n.to_string()),
        V::UInt128(n) => CellValue::BigInt(n.to_string()),
        V::Int256(n) => CellValue::BigInt(i256_string(*n)),
        V::UInt256(n) => CellValue::BigInt(u256_digits(n.0)),
        V::Float32(f) => float_cell(*f as f64),
        V::Float64(f) => float_cell(*f),
        V::Decimal32(scale, n) => CellValue::Decimal(decimal_string(n.to_string(), *scale)),
        V::Decimal64(scale, n) => CellValue::Decimal(decimal_string(n.to_string(), *scale)),
        V::Decimal128(scale, n) => CellValue::Decimal(decimal_string(n.to_string(), *scale)),
        V::Decimal256(scale, n) => CellValue::Decimal(decimal_string(i256_string(*n), *scale)),
        V::String(bytes) => match std::str::from_utf8(bytes) {
            Ok(s) => CellValue::Str(s.to_string()),
            Err(_) => CellValue::Str(format!("{:?}", bytes)),
        },
        V::Uuid(u) => CellValue::Str(u.to_string()),
        // klickhouse's Display emits SQL literals such as `makeDate(...)` so the text round-trips through
        // SQL. These arms format dates with chrono to match clickhouse-client.
        V::Date(d) => {
            let nd: chrono::NaiveDate = (*d).into();
            CellValue::DateTime(nd.format("%Y-%m-%d").to_string())
        }
        V::DateTime(dt) => match chrono::DateTime::<Tz>::try_from(*dt) {
            Ok(cdt) => CellValue::DateTime(cdt.format("%Y-%m-%d %H:%M:%S").to_string()),
            Err(_) => CellValue::DateTime(format!("{value}")),
        },
        V::DateTime64(dt) => {
            let precision = dt.2;
            match chrono::DateTime::<Tz>::try_from(*dt) {
                Ok(cdt) => {
                    let fmt = match precision {
                        0 => "%Y-%m-%d %H:%M:%S",
                        1..=3 => "%Y-%m-%d %H:%M:%S%.3f",
                        4..=6 => "%Y-%m-%d %H:%M:%S%.6f",
                        _ => "%Y-%m-%d %H:%M:%S%.9f",
                    };
                    CellValue::DateTime(cdt.format(fmt).to_string())
                }
                // Value's Display returns an error here, and `format!` panics on that.
                Err(_) => CellValue::Other(format!("out-of-range DateTime64: {}", dt.1 as i64)),
            }
        }
        V::Enum8(n) => CellValue::Int(*n as i64),
        V::Enum16(n) => CellValue::Int(*n as i64),
        V::Array(_) | V::Tuple(_) | V::Map(..) => CellValue::Other(render_composite(value, None)),
        _ => CellValue::Other(format!("{value}")),
    }
}

/// ClickHouse can nest Nullable and LowCardinality in either order, so one pass can miss a wrapper.
fn peel(ty: &Type) -> &Type {
    let mut inner = ty;
    loop {
        let next = inner.strip_null().strip_low_cardinality();
        if std::ptr::eq(next, inner) {
            return inner;
        }
        inner = next;
    }
}

fn is_composite(value: &Value) -> bool {
    matches!(value, Value::Array(_) | Value::Tuple(_) | Value::Map(..))
}

/// klickhouse's Display writes nested dates as `makeDate(...)` and non-ASCII bytes as `\xNN`.
/// The output must stay a valid SQL literal because "Copy as SQL VALUES" pastes it.
fn render_composite(value: &Value, ty: Option<&Type>) -> String {
    let mut out = String::new();
    write_nested(&mut out, value, ty);
    out
}

fn write_nested(out: &mut String, value: &Value, ty: Option<&Type>) {
    let ty = ty.map(peel);
    match value {
        Value::Array(items) => {
            let item_ty = match ty {
                Some(Type::Array(t)) => Some(&**t),
                _ => None,
            };
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_nested(out, item, item_ty);
            }
            out.push(']');
        }
        Value::Tuple(items) => {
            let item_tys = match ty {
                Some(Type::Tuple(ts)) => Some(ts),
                _ => None,
            };
            out.push('(');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_nested(out, item, item_tys.and_then(|ts| ts.get(i)));
            }
            out.push(')');
        }
        Value::Map(keys, values) => {
            let (key_ty, value_ty) = match ty {
                Some(Type::Map(k, v)) => (Some(&**k), Some(&**v)),
                _ => (None, None),
            };
            out.push('{');
            for (i, (k, v)) in keys.iter().zip(values).enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_nested(out, k, key_ty);
                out.push(':');
                write_nested(out, v, value_ty);
            }
            out.push('}');
        }
        // `convert` maps NaN and Inf to Null, so a composite keeps klickhouse's spelling instead.
        Value::Float32(_) | Value::Float64(_) => out.push_str(&value.to_string()),
        // `convert` turns invalid UTF-8 into a debug list (`[255]`), which would change what
        // "Copy as SQL VALUES" pastes.
        Value::String(bytes) => write_quoted(out, bytes),
        scalar => {
            let cell = match ty {
                Some(t) => convert_typed(scalar, t),
                None => convert(scalar),
            };
            match cell {
                CellValue::Null => out.push_str("NULL"),
                CellValue::Int(n) => out.push_str(&n.to_string()),
                CellValue::Float(f) => out.push_str(&f.to_string()),
                CellValue::BigInt(s) | CellValue::Decimal(s) | CellValue::Other(s) => {
                    out.push_str(&s)
                }
                CellValue::Str(s) | CellValue::DateTime(s) => write_quoted(out, s.as_bytes()),
            }
        }
    }
}

fn write_quoted(out: &mut String, bytes: &[u8]) {
    out.push('\'');
    for chunk in bytes.utf8_chunks() {
        for c in chunk.valid().chars() {
            match c {
                '\\' => out.push_str("\\\\"),
                '\'' => out.push_str("\\'"),
                '\n' => out.push_str("\\n"),
                '\t' => out.push_str("\\t"),
                '\r' => out.push_str("\\r"),
                '\0' => out.push_str("\\0"),
                '\x07' => out.push_str("\\a"),
                '\x08' => out.push_str("\\b"),
                '\x0B' => out.push_str("\\v"),
                '\x0C' => out.push_str("\\f"),
                c => out.push(c),
            }
        }
        for b in chunk.invalid() {
            out.push_str(&format!("\\x{b:02X}"));
        }
    }
    out.push('\'');
}

fn float_cell(f: f64) -> CellValue {
    if f.is_finite() {
        CellValue::Float(f)
    } else {
        CellValue::Null
    }
}

/// klickhouse's Display drops the point when the integer has fewer digits than the scale
/// (0.05 reads `5`), misplaces the sign, leaves a trailing dot at scale 0, and panics on Decimal256.
fn decimal_string(raw: String, scale: usize) -> String {
    if scale == 0 {
        return raw;
    }
    let (sign, digits) = match raw.strip_prefix('-') {
        Some(d) => ("-", d),
        None => ("", raw.as_str()),
    };
    let padded = format!("{digits:0>width$}", width = scale + 1);
    let (int, frac) = padded.split_at(padded.len() - scale);
    format!("{sign}{int}.{frac}")
}

/// klickhouse's `i256` and `u256` Display print hex (`0xFF…FB` for -5).
fn u256_digits(mut be: [u8; 32]) -> String {
    let mut digits = Vec::new();
    while be.iter().any(|&b| b != 0) {
        let mut rem = 0u32;
        for b in be.iter_mut() {
            let cur = (rem << 8) | u32::from(*b);
            *b = (cur / 10) as u8;
            rem = cur % 10;
        }
        digits.push(rem as u8);
    }
    if digits.is_empty() {
        return "0".into();
    }
    digits.iter().rev().map(|&d| char::from(b'0' + d)).collect()
}

/// `i256` holds big-endian two's complement, so negatives are negated before taking digits.
fn i256_string(n: klickhouse::i256) -> String {
    let mut be = n.0;
    if be[0] & 0x80 == 0 {
        return u256_digits(be);
    }
    for b in be.iter_mut() {
        *b = !*b;
    }
    for b in be.iter_mut().rev() {
        let (sum, carry) = b.overflowing_add(1);
        *b = sum;
        if !carry {
            break;
        }
    }
    format!("-{}", u256_digits(be))
}

#[cfg(test)]
mod tests {
    use super::*;
    use klickhouse::{Date, DateTime, DynDateTime64};

    #[test]
    fn int64_above_the_js_safe_range_stays_exact() {
        assert_eq!(
            convert(&Value::Int64(i64::MIN)),
            CellValue::BigInt(i64::MIN.to_string())
        );
    }

    #[test]
    fn datetime64_before_1970_or_out_of_range_does_not_panic() {
        let dt = |raw: i64| convert(&Value::DateTime64(DynDateTime64(Tz::UTC, raw as u64, 3)));
        assert_eq!(
            dt(-2_208_988_800_000),
            CellValue::DateTime("1900-01-01 00:00:00.000".into())
        );
        assert!(matches!(dt(i64::MAX), CellValue::Other(_)));
    }

    #[test]
    fn wide_integers_print_in_base_ten() {
        let from_i128 = |n: i128| {
            let mut be = [if n < 0 { 0xFF } else { 0 }; 32];
            be[16..].copy_from_slice(&n.to_be_bytes());
            klickhouse::i256(be)
        };
        assert_eq!(i256_string(from_i128(-5)), "-5");
        assert_eq!(i256_string(from_i128(0)), "0");
        assert_eq!(i256_string(from_i128(i128::MAX)), i128::MAX.to_string());
        assert_eq!(i256_string(from_i128(i128::MIN)), i128::MIN.to_string());
        let mut min = [0u8; 32];
        min[0] = 0x80;
        assert_eq!(
            i256_string(klickhouse::i256(min)),
            "-57896044618658097711785492504343953926634992332820282019728792003956564819968"
        );
        assert_eq!(
            u256_digits([0xFF; 32]),
            "115792089237316195423570985008687907853269984665640564039457584007913129639935"
        );
        assert_eq!(
            convert(&Value::Decimal256(3, from_i128(-123_456))),
            CellValue::Decimal("-123.456".into())
        );
    }

    #[test]
    fn decimals_place_the_point() {
        let dec = |v: Value| match convert(&v) {
            CellValue::Decimal(s) => s,
            c => panic!("expected Decimal, got {c:?}"),
        };
        assert_eq!(dec(Value::Decimal64(2, 5)), "0.05");
        assert_eq!(dec(Value::Decimal32(2, -5)), "-0.05");
        assert_eq!(dec(Value::Decimal64(1, -5)), "-0.5");
        assert_eq!(dec(Value::Decimal128(2, -150)), "-1.50");
        assert_eq!(dec(Value::Decimal128(2, 12345)), "123.45");
        assert_eq!(dec(Value::Decimal64(3, 0)), "0.000");
        assert_eq!(dec(Value::Decimal128(0, 123)), "123");
        assert_eq!(dec(Value::Decimal128(0, -123)), "-123");
    }

    const APR_5: Date = Date(19818);

    fn other(cell: CellValue) -> String {
        match cell {
            CellValue::Other(s) => s,
            c => panic!("expected Other, got {c:?}"),
        }
    }

    #[test]
    fn array_of_dates_renders_as_dates() {
        let v = Value::Array(vec![Value::Date(APR_5), Value::Date(Date(19819))]);
        let ty = Type::Array(Box::new(Type::Date));
        assert_eq!(other(convert_typed(&v, &ty)), "['2024-04-05','2024-04-06']");
        assert_eq!(other(convert(&v)), "['2024-04-05','2024-04-06']");
    }

    #[test]
    fn nested_datetimes_and_nulls() {
        let ms = 1_712_312_430_123;
        let v = Value::Array(vec![
            Value::DateTime64(DynDateTime64(Tz::UTC, ms, 3)),
            Value::Null,
        ]);
        let ty = Type::Array(Box::new(Type::Nullable(Box::new(Type::DateTime64(
            3,
            Tz::UTC,
        )))));
        assert_eq!(
            other(convert_typed(&v, &ty)),
            "['2024-04-05 10:20:30.123',NULL]"
        );
        let v = Value::Tuple(vec![Value::DateTime(DateTime(Tz::UTC, 1_712_312_430))]);
        assert_eq!(other(convert(&v)), "('2024-04-05 10:20:30')");
    }

    #[test]
    fn tuple_renders_enum_labels_and_escapes_strings() {
        let ty = Type::Tuple(vec![
            Type::LowCardinality(Box::new(Type::String)),
            Type::Enum8(vec![("TOO_MANY_ROWS".into(), 2)]),
        ]);
        let v = Value::Tuple(vec![Value::String(b"it's\n".to_vec()), Value::Enum8(2)]);
        assert_eq!(
            other(convert_typed(&v, &ty)),
            r"('it\'s\n','TOO_MANY_ROWS')"
        );
    }

    #[test]
    fn nested_invalid_utf8_keeps_its_bytes() {
        let v = Value::Array(vec![Value::String(vec![0xFF, b'a', 0xC3, 0xA9, b'\''])]);
        assert_eq!(other(convert(&v)), r"['\xFFaé\'']");
    }

    #[test]
    fn map_keeps_utf8_and_bare_numbers() {
        let ty = Type::Map(Box::new(Type::String), Box::new(Type::UInt64));
        let v = Value::Map(
            vec![Value::String("José".as_bytes().to_vec())],
            vec![Value::UInt64(7)],
        );
        assert_eq!(other(convert_typed(&v, &ty)), "{'José':7}");
    }

    #[test]
    fn nested_arrays_without_type() {
        let v = Value::Array(vec![
            Value::Array(vec![Value::Date(APR_5)]),
            Value::Array(vec![]),
        ]);
        assert_eq!(other(convert(&v)), "[['2024-04-05'],[]]");
    }
}
