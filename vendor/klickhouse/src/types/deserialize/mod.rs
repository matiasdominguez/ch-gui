pub mod array;
pub mod geo;
pub mod low_cardinality;
pub mod map;
pub mod nullable;
pub mod sized;
pub mod string;
pub mod tuple;

use super::*;

// chgui patch: a decreasing server offset would underflow array lengths and overrun map keys.
fn check_offsets(offsets: &[u64]) -> Result<()> {
    if offsets.windows(2).any(|w| w[0] > w[1]) {
        return Err(KlickhouseError::ProtocolError(
            "array offsets are not increasing".to_string(),
        ));
    }
    Ok(())
}
