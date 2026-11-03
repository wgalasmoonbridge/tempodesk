use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use tempodesk_core::error::{AppError, Result};

fn problem(message: &str) -> AppError {
    AppError::Internal(message.into())
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    assets: Vec<Asset>,
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    digest: Option<String>,
    browser_download_url: String,
}

async fn bounded(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>> {
    let mut result = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| problem("The tunnel download was interrupted; retry creating the link"))?
    {
        if result.len() + chunk.len() > limit {
            return Err(problem("Tunnel download exceeded its size limit"));
        }
        result.extend_from_slice(&chunk);
    }
    Ok(result)
}

/// Only official release assets with a published SHA-256 digest can be executed.
pub async fn binary(directory: &Path, client: &reqwest::Client) -> Result<PathBuf> {
    let asset_name = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => "cloudflared-windows-amd64.exe",
        ("macos", "x86_64") => "cloudflared-darwin-amd64.tgz",
        ("macos", "aarch64") => "cloudflared-darwin-arm64.tgz",
        ("linux", "x86_64") => "cloudflared-linux-amd64",
        ("linux", "aarch64") => "cloudflared-linux-arm64",
        _ => {
            return Err(AppError::Unsupported(
                "Live sharing is unavailable on this architecture".into(),
            ))
        }
    };
    let metadata = client.get("https://api.github.com/repos/cloudflare/cloudflared/releases/latest")
        .timeout(std::time::Duration::from_secs(30)).send().await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|_| problem("Cannot check the official tunnel download. Check your Internet connection and retry"))?;
    let release: Release = serde_json::from_slice(&bounded(metadata, 2_000_000).await?)?;
    let version = release.tag_name.trim_start_matches('v');
    if version.is_empty()
        || version.len() > 24
        || !version.bytes().all(|b| b.is_ascii_digit() || b == b'.')
    {
        return Err(problem("Unexpected tunnel release version"));
    }
    let asset = release
        .assets
        .into_iter()
        .find(|a| a.name == asset_name)
        .ok_or_else(|| problem("No official tunnel download was found for this platform"))?;
    let digest = asset
        .digest
        .as_deref()
        .and_then(|s| s.strip_prefix("sha256:"))
        .filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or_else(|| problem("The tunnel release has no SHA-256 checksum; download refused"))?;
    tokio::fs::create_dir_all(directory).await?;
    let filename = format!("cloudflared-{version}-{asset_name}");
    let archive = directory.join(&filename);
    let cached = tokio::fs::read(&archive).await.ok();
    let verified = cached.filter(|bytes| format!("{:x}", Sha256::digest(bytes)) == digest);
    let bytes = if let Some(bytes) = verified {
        bytes
    } else {
        let url = reqwest::Url::parse(&asset.browser_download_url)
            .map_err(|_| problem("Invalid tunnel download source"))?;
        if url.scheme() != "https"
            || url.host_str() != Some("github.com")
            || !url
                .path()
                .starts_with("/cloudflare/cloudflared/releases/download/")
        {
            return Err(problem("Unexpected tunnel download source"));
        }
        let download = client
            .get(url)
            .timeout(std::time::Duration::from_secs(180))
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|_| {
                problem("Cannot download the tunnel helper. Retry when connected to the Internet")
            })?;
        let bytes = bounded(download, 150_000_000).await?;
        if format!("{:x}", Sha256::digest(&bytes)) != digest {
            return Err(problem(
                "Tunnel checksum verification failed; execution refused",
            ));
        }
        tokio::fs::write(&archive, &bytes).await?;
        bytes
    };
    let executable = if asset_name.ends_with(".tgz") {
        let path = directory.join(format!("cloudflared-{version}-{}", std::env::consts::ARCH));
        // Never extract archive paths. Read only the expected regular file into our fixed filename.
        let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(&bytes[..]));
        let mut binary = None;
        for entry in tar.entries()? {
            let entry = entry?;
            if entry.header().entry_type().is_file()
                && entry.path()?.as_ref() == Path::new("cloudflared")
            {
                let mut contents = Vec::new();
                entry.take(150_000_001).read_to_end(&mut contents)?;
                if contents.len() > 150_000_000 {
                    return Err(problem("Tunnel executable exceeded its size limit"));
                }
                binary = Some(contents);
                break;
            }
        }
        tokio::fs::write(
            &path,
            binary.ok_or_else(|| problem("Expected tunnel executable was missing"))?,
        )
        .await?;
        path
    } else {
        archive
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).await?;
    }
    Ok(executable)
}

pub fn hostname(line: &str) -> Option<String> {
    line.split_whitespace()
        .filter_map(|part| part.strip_prefix("https://"))
        .find(|host| {
            let Some(label) = host.strip_suffix(".trycloudflare.com") else {
                return false;
            };
            !label.is_empty()
                && label.len() <= 63
                && label
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
        .map(|host| format!("https://{host}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_an_exact_cloudflare_https_hostname_is_accepted() {
        assert_eq!(
            hostname("| https://sample-demo.trycloudflare.com |"),
            Some("https://sample-demo.trycloudflare.com".into())
        );
        for line in [
            "http://a.trycloudflare.com",
            "https://a.trycloudflare.com.evil.test",
            "https://a.trycloudflare.com/path",
            "https://a.b.trycloudflare.com",
            "https://@a.trycloudflare.com",
        ] {
            assert_eq!(hostname(line), None);
        }
    }
}
