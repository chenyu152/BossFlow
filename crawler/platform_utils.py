#!/usr/bin/env python3
"""
跨平台工具模块 — 封装 Windows / macOS 通知、弹窗、Chrome 激活等 OS 操作。
从 ai-pm-job-dashboard 项目中提取，可独立使用。
"""
import os
import sys
import platform
import subprocess
import logging

logger = logging.getLogger('platform_utils')

IS_WINDOWS = platform.system() == 'Windows'
IS_MAC = platform.system() == 'Darwin'


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return str(value).strip().lower() in {'1', 'true', 'yes', 'on'}


def is_unattended_mode() -> bool:
    return _env_flag('AI_PM_UNATTENDED', False)


# ============ 通知 ============

def notify(title: str, message: str):
    """发送系统通知（非阻塞）"""
    try:
        if IS_WINDOWS:
            _notify_windows(title, message)
        elif IS_MAC:
            _notify_mac(title, message)
        else:
            logger.info(f'[通知] {title}: {message}')
    except Exception as e:
        logger.warning(f'通知发送失败: {e}')


def _notify_windows(title, message):
    ps_script = f'''
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null
    $template = @"
    <toast>
        <visual>
            <binding template="ToastGeneric">
                <text>{title}</text>
                <text>{message}</text>
            </binding>
        </visual>
        <audio silent="false"/>
    </toast>
"@
    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml($template)
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("AI岗位爬取").Show($toast)
    '''
    try:
        subprocess.Popen(
            ['powershell', '-NoProfile', '-Command', ps_script],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW
        )
    except Exception:
        import threading
        threading.Thread(
            target=_msgbox_windows, args=(title, message, 0x40), daemon=True
        ).start()


def _notify_mac(title, message):
    script = f'display notification "{message}" with title "{title}" sound name "Glass"'
    subprocess.run(['osascript', '-e', script], timeout=5)


# ============ 弹窗对话框 ============

MB_OK = 0x00
MB_OKCANCEL = 0x01
MB_YESNO = 0x04
MB_ICONINFO = 0x40
MB_ICONWARNING = 0x30
MB_ICONSTOP = 0x10
MB_ICONQUESTION = 0x20
MB_SYSTEMMODAL = 0x1000

IDOK = 1
IDCANCEL = 2
IDYES = 6
IDNO = 7


def _msgbox_windows(title, message, flags=MB_OK | MB_ICONINFO):
    import ctypes
    return ctypes.windll.user32.MessageBoxW(0, message, title, flags)


def show_dialog(title: str, message: str, buttons='ok', icon='info'):
    """
    显示弹窗对话框，等待用户点击。
    buttons: 'ok' | 'okcancel' | 'yesno'
    icon: 'info' | 'warning' | 'error' | 'question'
    返回: 'ok' | 'cancel' | 'yes' | 'no'
    """
    if is_unattended_mode():
        logger.info(f'[无人值守-跳过弹窗] {title}: {message[:120]}')
        return 'cancel' if buttons == 'okcancel' else ('no' if buttons == 'yesno' else 'ok')
    try:
        if IS_WINDOWS:
            return _dialog_windows(title, message, buttons, icon)
        elif IS_MAC:
            return _dialog_mac(title, message, buttons, icon)
        else:
            logger.info(f'[弹窗] {title}: {message}')
            return 'ok'
    except Exception as e:
        logger.warning(f'弹窗失败: {e}')
        return 'ok'


def _dialog_windows(title, message, buttons, icon):
    icon_map = {'info': MB_ICONINFO, 'warning': MB_ICONWARNING,
                'error': MB_ICONSTOP, 'question': MB_ICONQUESTION}
    btn_map = {'ok': MB_OK, 'okcancel': MB_OKCANCEL, 'yesno': MB_YESNO}
    flags = btn_map.get(buttons, MB_OK) | icon_map.get(icon, MB_ICONINFO) | MB_SYSTEMMODAL
    result = _msgbox_windows(title, message, flags)
    return {IDOK: 'ok', IDCANCEL: 'cancel', IDYES: 'yes', IDNO: 'no'}.get(result, 'ok')


def _dialog_mac(title, message, buttons, icon):
    icon_map = {'info': 'note', 'warning': 'caution', 'error': 'stop', 'question': 'note'}
    btn_map = {
        'ok': 'buttons {"好的"} default button 1',
        'okcancel': 'buttons {"取消", "好的"} default button 2',
        'yesno': 'buttons {"否", "是"} default button 2',
    }
    mac_icon = icon_map.get(icon, 'note')
    mac_buttons = btn_map.get(buttons, 'buttons {"好的"} default button 1')
    script = (
        f'display dialog "{message}" with title "{title}" '
        f'{mac_buttons} with icon {mac_icon}'
    )
    result = subprocess.run(['osascript', '-e', script],
                            capture_output=True, text=True, timeout=600)
    stdout = result.stdout.lower()
    if '取消' in stdout or '否' in stdout:
        return 'cancel' if buttons == 'okcancel' else 'no'
    return 'ok' if buttons != 'yesno' else 'yes'


def show_login_dialog(title: str, message: str):
    """
    登录专用弹窗：两个按钮「取消」/「已登录」
    返回: True=用户点了已登录, False=取消
    """
    if is_unattended_mode():
        logger.info(f'[无人值守-跳过登录弹窗] {title}: {message[:120]}')
        return False
    try:
        if IS_WINDOWS:
            import ctypes
            result = ctypes.windll.user32.MessageBoxW(
                0, message, title,
                MB_YESNO | MB_ICONQUESTION | MB_SYSTEMMODAL
            )
            return result == IDYES
        elif IS_MAC:
            result = subprocess.run(['osascript', '-e',
                f'display dialog "{message}" '
                f'with title "{title}" '
                f'buttons {{"取消", "已登录"}} default button 2 with icon caution'],
                capture_output=True, text=True, timeout=600)
            return result.returncode == 0 and '取消' not in result.stdout
        else:
            logger.info(f'[弹窗] {title}: {message}')
            return False
    except Exception as e:
        logger.warning(f'登录弹窗失败: {e}')
        return False


# ============ Chrome 窗口激活 ============

def activate_chrome():
    """将 Chrome 窗口带到前台"""
    try:
        if IS_WINDOWS:
            _activate_chrome_windows()
        elif IS_MAC:
            subprocess.run(['osascript', '-e',
                'tell application "Google Chrome" to activate'], timeout=5)
    except Exception as e:
        logger.warning(f'Chrome 激活失败: {e}')


def _activate_chrome_windows():
    import ctypes
    import ctypes.wintypes

    user32 = ctypes.windll.user32
    target = None

    EnumWindowsProc = ctypes.WINFUNCTYPE(
        ctypes.wintypes.BOOL, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM
    )

    def callback(hwnd, lParam):
        nonlocal target
        length = user32.GetWindowTextLengthW(hwnd)
        if length > 0:
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            if 'Chrome' in buf.value or 'chrome' in buf.value:
                if user32.IsWindowVisible(hwnd):
                    target = hwnd
                    return False
        return True

    user32.EnumWindows(EnumWindowsProc(callback), 0)

    if target:
        SW_RESTORE = 9
        user32.ShowWindow(target, SW_RESTORE)
        user32.SetForegroundWindow(target)


# ============ 防息屏 ============

_keep_awake_state = {'active': False}


def start_keep_awake():
    """阻止系统进入休眠/息屏"""
    try:
        if IS_WINDOWS:
            import ctypes
            ES_CONTINUOUS = 0x80000000
            ES_SYSTEM_REQUIRED = 0x00000001
            ES_DISPLAY_REQUIRED = 0x00000002
            ctypes.windll.kernel32.SetThreadExecutionState(
                ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
            )
            _keep_awake_state['active'] = True
            logger.info('防休眠已启动')
        elif IS_MAC:
            proc = subprocess.Popen(
                ['caffeinate', '-i', '-d'],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            _keep_awake_state['active'] = True
            _keep_awake_state['proc'] = proc
            logger.info(f'caffeinate 已启动 (PID: {proc.pid})')
    except Exception as e:
        logger.warning(f'防休眠启动失败: {e}')


def stop_keep_awake():
    """恢复正常休眠策略"""
    try:
        if IS_WINDOWS:
            if _keep_awake_state.get('active'):
                import ctypes
                ES_CONTINUOUS = 0x80000000
                ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS)
                _keep_awake_state['active'] = False
                logger.info('防休眠已恢复')
        elif IS_MAC:
            proc = _keep_awake_state.get('proc')
            if proc and proc.poll() is None:
                proc.terminate()
                proc.wait(timeout=5)
                logger.info('caffeinate 已终止')
            _keep_awake_state['active'] = False
            _keep_awake_state.pop('proc', None)
    except Exception as e:
        logger.warning(f'防休眠恢复失败: {e}')


# ============ 工具 ============

def get_python():
    """返回当前 Python 解释器路径"""
    return sys.executable


def open_file(path):
    """用系统默认程序打开文件"""
    try:
        path = str(path)
        if IS_WINDOWS:
            os.startfile(path)
        elif IS_MAC:
            subprocess.Popen(['open', path])
        else:
            subprocess.Popen(['xdg-open', path])
    except Exception as e:
        logger.warning(f'打开文件失败: {e}')
