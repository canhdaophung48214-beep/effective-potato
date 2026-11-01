param([string]$Name='wechat_devtools_home.png')
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class UiWindow{[StructLayout(LayoutKind.Sequential)]public struct RECT{public int L,T,R,B;}[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out RECT r);[DllImport("user32.dll")]public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint f);}'
$process=Get-Process | Where-Object {$_.MainWindowTitle -eq 'shishen-ab-history-ui'} | Select-Object -First 1
if(!$process){throw 'PROJECT_WINDOW_NOT_FOUND'}
$rect=New-Object UiWindow+RECT
[UiWindow]::GetWindowRect($process.MainWindowHandle,[ref]$rect)|Out-Null
$bitmap=[System.Drawing.Bitmap]::new(($rect.R-$rect.L),($rect.B-$rect.T))
$graphics=[System.Drawing.Graphics]::FromImage($bitmap)
$dc=$graphics.GetHdc()
$ok=[UiWindow]::PrintWindow($process.MainWindowHandle,$dc,2)
$graphics.ReleaseHdc($dc)
$out=Join-Path $PSScriptRoot ('evidence\'+$Name)
$bitmap.Save($out)
$graphics.Dispose();$bitmap.Dispose()
Write-Output "PrintWindow=$ok Path=$out"
