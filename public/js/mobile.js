/**
 * Monochrome Chat - Mobile Adaptation (Capacitor)
 */

document.addEventListener('DOMContentLoaded', () => {
    // Detect if running under Capacitor
    const isCapacitor = window.Capacitor !== undefined;

    if (isCapacitor) {
        initCapacitor();
    }
});

async function initCapacitor() {
    const { StatusBar, Style } = Capacitor.Plugins;
    const { App } = Capacitor.Plugins;

    // 1. Style StatusBar
    try {
        if (StatusBar) {
            await StatusBar.setStyle({ style: Style.Dark });
            await StatusBar.setBackgroundColor({ color: '#000000' });
        }
    } catch (e) { console.warn('StatusBar plugin not available'); }

    // 2. Handle Hardware Back Button
    if (App) {
        App.addListener('backButton', (data) => {
            const activeModals = document.querySelectorAll('.active-modal, .active, .modal-overlay.active');
            
            if (activeModals.length > 0) {
                // If any modal/panel is open, close it instead of exiting
                if (typeof window.closeAllModals === 'function') {
                    window.closeAllModals();
                } else {
                    // Fallback: remove 'active' class from anything that has it
                    activeModals.forEach(el => el.classList.remove('active', 'active-modal'));
                }
            } else {
                // Minimalist exit: if on main screen, exit app (or do nothing)
                // App.exitApp();
            }
        });
    }

    // 3. Vibration feedback
    window.vibrate = function(ms = 50) {
        if (Capacitor.isNativePlatform()) {
            // Use Haptics if available, else navigator.vibrate
            if (navigator.vibrate) navigator.vibrate(ms);
        }
    };

    console.log('⚲ Monochrome Mobile Engine Loaded');
}

// Global helper for mobile vibration
window.vibrate = window.vibrate || function(ms) {
    if (navigator.vibrate) navigator.vibrate(ms);
};
