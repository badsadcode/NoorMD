// Re-export TOAST UI Editor as the same global the original prototype used (window.toastui.Editor).
import Editor from '@toast-ui/editor';
window.toastui = Object.assign(window.toastui || {}, { Editor });
