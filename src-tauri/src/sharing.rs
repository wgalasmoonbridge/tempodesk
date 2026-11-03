use crate::{
    error::{AppError, Result},
    state::AppState,
};
use tauri::{Manager, State};
use tempodesk_sharing::{ShareInput, ShareStatus, SharedReport, SharingService};

#[tauri::command]
pub async fn preview_sharing(
    state: State<'_, AppState>,
    input: ShareInput,
) -> Result<SharedReport> {
    let path = state.db_path();
    tauri::async_runtime::spawn_blocking(move || SharingService::preview(&path, input))
        .await
        .map_err(|_| AppError::Internal("Sharing preview could not be generated".into()))?
}

#[tauri::command]
pub async fn start_sharing(app: tauri::AppHandle, input: ShareInput) -> Result<ShareStatus> {
    let state = app.state::<AppState>();
    let path = state.db_path();
    let tools = state.data_dir().join("sharing-tools");
    let service = app.state::<SharingService>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.start(&path, tools, input))
        .await
        .map_err(|_| AppError::Internal("Sharing could not be started".into()))?
}

#[tauri::command]
pub fn get_sharing_status(service: State<'_, SharingService>) -> ShareStatus {
    service.status()
}

#[tauri::command]
pub fn stop_sharing(service: State<'_, SharingService>) -> ShareStatus {
    service.stop()
}

#[tauri::command]
pub fn rotate_sharing_link(service: State<'_, SharingService>) -> Result<ShareStatus> {
    service.rotate()
}
