use std::sync::{Arc, OnceLock};

use rustls::{ClientConfig, RootCertStore};

use crate::error::{AppError, AppResult};

/// `load_native_certs` makes many macOS Security framework calls, so the config is built only once.
static SYSTEM_CLIENT_CONFIG: OnceLock<Arc<ClientConfig>> = OnceLock::new();

fn system_client_config() -> Arc<ClientConfig> {
    SYSTEM_CLIENT_CONFIG
        .get_or_init(|| {
            let mut roots = RootCertStore::empty();
            match rustls_native_certs::load_native_certs() {
                result if !result.certs.is_empty() => {
                    for cert in result.certs {
                        let _ = roots.add(cert);
                    }
                }
                _ => {
                    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
                }
            }
            Arc::new(
                ClientConfig::builder()
                    .with_root_certificates(roots)
                    .with_no_client_auth(),
            )
        })
        .clone()
}

/// A custom CA becomes the only trust root. The system roots are not added alongside it.
pub fn build_client_config(custom_ca_pem: Option<&str>) -> AppResult<Arc<ClientConfig>> {
    let Some(pem) = custom_ca_pem else {
        return Ok(system_client_config());
    };

    let mut roots = RootCertStore::empty();
    let mut cursor = std::io::Cursor::new(pem.as_bytes());
    let certs: Vec<_> = rustls_pemfile::certs(&mut cursor)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| AppError::Tls(format!("could not read the custom CA PEM: {e}")))?;
    if certs.is_empty() {
        return Err(AppError::Tls(
            "the custom CA PEM contains no certificates".into(),
        ));
    }
    for cert in certs {
        roots
            .add(cert)
            .map_err(|e| AppError::Tls(format!("invalid CA certificate: {e}")))?;
    }

    let config = ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();

    Ok(Arc::new(config))
}
