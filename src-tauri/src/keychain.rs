use crate::error::{AppError, AppResult};

const SERVICE: &str = "com.matiasdominguez.chgui";

fn entry(connection_id: &str) -> AppResult<keyring::Entry> {
    keyring::Entry::new(SERVICE, connection_id).map_err(AppError::from)
}

pub fn save(connection_id: &str, password: &str) -> AppResult<()> {
    let e = entry(connection_id)?;
    e.set_password(password)?;
    Ok(())
}

pub fn load(connection_id: &str) -> AppResult<Option<String>> {
    let e = entry(connection_id)?;
    match e.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::from(e)),
    }
}

pub fn delete(connection_id: &str) -> AppResult<()> {
    let e = entry(connection_id)?;
    match e.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::from(e)),
    }
}
