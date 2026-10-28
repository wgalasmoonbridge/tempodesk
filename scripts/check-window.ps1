Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinCheck {
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
}
"@
$p = Get-Process tempodesk | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 1
if (-not $p) { Write-Output "NO_PROCESS"; exit 1 }
$h = $p.MainWindowHandle
if ($h -eq [IntPtr]::Zero) { Write-Output "NO_HANDLE"; exit 1 }
Write-Output ("pid=" + $p.Id + " visible=" + [WinCheck]::IsWindowVisible($h) + " window=" + [WinCheck]::IsWindow($h))
