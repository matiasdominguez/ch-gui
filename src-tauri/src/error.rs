use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("clickhouse error: {0}")]
    ClickHouse(String),
    #[error("clickhouse error: {message}")]
    ClickHouseServer { code: i32, message: String },
    #[error("tls error: {0}")]
    Tls(String),
    #[error("keychain error: {0}")]
    Keychain(String),
    #[error("invalid input: {0}")]
    Invalid(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    /// No query reached the server. The kind "connect" stops the UI from reporting a failed query.
    #[error("{0}")]
    Connect(Box<AppError>),
}

impl AppError {
    pub fn clickhouse_code(&self) -> Option<i32> {
        match self {
            AppError::ClickHouseServer { code, .. } => Some(*code),
            _ => None,
        }
    }

    /// Code 497 alone is ClickHouse's generic `ACCESS_DENIED`, so the message must also name REMOTE.
    /// Otherwise an unrelated denial would disable cluster fan-out for the whole connection.
    pub fn is_remote_access_denied(&self) -> bool {
        const CH_CODE_ACCESS_DENIED: i32 = 497;
        matches!(
            self,
            AppError::ClickHouseServer { code, message }
                if *code == CH_CODE_ACCESS_DENIED
                    && message.to_ascii_uppercase().contains("REMOTE")
        )
    }
}

impl From<klickhouse::KlickhouseError> for AppError {
    fn from(e: klickhouse::KlickhouseError) -> Self {
        match e {
            klickhouse::KlickhouseError::ServerException { code, .. } => {
                AppError::ClickHouseServer {
                    code,
                    message: e.to_string(),
                }
            }
            _ => AppError::ClickHouse(e.to_string()),
        }
    }
}

impl From<keyring::Error> for AppError {
    fn from(e: keyring::Error) -> Self {
        AppError::Keychain(e.to_string())
    }
}

#[derive(Serialize)]
struct SerializableError {
    kind: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<i32>,
}

impl AppError {
    pub fn connect(e: AppError) -> Self {
        AppError::Connect(Box::new(e))
    }

    fn wire(&self) -> (&'static str, String) {
        match self {
            AppError::ClickHouse(m) => ("clickhouse", m.clone()),
            AppError::ClickHouseServer { message, .. } => ("clickhouse", message.clone()),
            AppError::Tls(m) => ("tls", m.clone()),
            AppError::Keychain(m) => ("keychain", m.clone()),
            AppError::Invalid(m) => ("invalid", m.clone()),
            AppError::Io(e) => ("io", e.to_string()),
            AppError::Connect(inner) => ("connect", inner.wire().1),
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let (kind, message) = self.wire();
        // `clickhouse_code` returns `None` for `Connect`, and a rejected login still has a server code.
        let code = match self {
            AppError::Connect(inner) => inner.clickhouse_code(),
            other => other.clickhouse_code(),
        };
        SerializableError {
            kind,
            message,
            code,
        }
        .serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    fn server_exception(code: i32) -> klickhouse::KlickhouseError {
        klickhouse::KlickhouseError::ServerException {
            code,
            name: "NOT_ENOUGH_PRIVILEGES".into(),
            message: "not enough privileges … READ ON REMOTE".into(),
            stack_trace: String::new(),
        }
    }

    #[test]
    fn server_exception_preserves_code() {
        let ae: AppError = server_exception(497).into();
        assert_eq!(ae.clickhouse_code(), Some(497));
    }

    #[test]
    fn non_server_errors_have_no_code() {
        let ae: AppError = klickhouse::KlickhouseError::ProtocolError("boom".into()).into();
        assert_eq!(ae.clickhouse_code(), None);
        assert_eq!(AppError::Invalid("bad".into()).clickhouse_code(), None);
    }

    #[test]
    fn remote_access_denied_needs_code_497_and_remote_in_message() {
        let remote = AppError::ClickHouseServer {
            code: 497,
            message: "497 ACCESS_DENIED: Not enough privileges. READ ON REMOTE".into(),
        };
        assert!(remote.is_remote_access_denied());

        let other_497 = AppError::ClickHouseServer {
            code: 497,
            message: "497 ACCESS_DENIED: not enough privileges on system.mutations".into(),
        };
        assert!(!other_497.is_remote_access_denied());

        let wrong_code = AppError::ClickHouseServer {
            code: 241,
            message: "remote server timed out".into(),
        };
        assert!(!wrong_code.is_remote_access_denied());

        assert!(!AppError::ClickHouse("READ ON REMOTE".into()).is_remote_access_denied());
    }

    #[test]
    fn server_exception_serializes_as_clickhouse_kind() {
        let ae: AppError = server_exception(497).into();
        let v = serde_json::to_value(&ae).unwrap();
        assert_eq!(v["kind"], "clickhouse");
        assert!(v["message"].as_str().unwrap().contains("497"));
    }

    #[test]
    fn connect_failure_keeps_its_text_under_its_own_kind() {
        let ae = AppError::connect(server_exception(516).into());
        let v = serde_json::to_value(&ae).unwrap();
        assert_eq!(v["kind"], "connect");
        let inner = serde_json::to_value(AppError::from(server_exception(516))).unwrap();
        assert_eq!(v["message"], inner["message"]);
        assert_eq!(ae.clickhouse_code(), None);
    }

    #[test]
    fn plain_clickhouse_serializes_backward_compatibly() {
        let ae = AppError::ClickHouse("legacy string".into());
        let v = serde_json::to_value(&ae).unwrap();
        assert_eq!(v["kind"], "clickhouse");
        assert_eq!(v["message"], "legacy string");
    }

    #[test]
    fn wire_carries_the_server_code() {
        let ae: AppError = server_exception(497).into();
        let v = serde_json::to_value(&ae).unwrap();
        assert_eq!(v["kind"], "clickhouse");
        assert_eq!(v["code"], 497);
        let wrapped = AppError::Connect(Box::new(server_exception(516).into()));
        assert_eq!(serde_json::to_value(&wrapped).unwrap()["code"], 516);
        let local = AppError::Invalid("x".into());
        assert!(serde_json::to_value(&local).unwrap().get("code").is_none());
    }
}
