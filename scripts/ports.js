const { runAsync, setButtonLoading, toast } = window.WeightLoggerUtils;

async function listPorts() {
    const body = document.getElementById('ports-body');
    if (!('serial' in navigator)) {
        body.innerHTML = '<tr><td colspan="3" class="px-4 py-4 text-center text-red-600 text-sm">Web Serial API is not supported in this environment.</td></tr>';
        return;
    }

    try {
        const ports = await navigator.serial.getPorts();
        if (!ports.length) {
            body.innerHTML = '<tr><td colspan="3" class="px-4 py-4 text-center text-gray-500 text-sm">No ports are authorised yet. Web Serial will not show newly plugged-in devices until you click "Request New Port Access" and select the device.</td></tr>';
            return;
        }

        const rows = await Promise.all(ports.map(async (port, index) => {
            let info = {};
            try {
                info = port.getInfo ? port.getInfo() : {};
            } catch {
                info = {};
            }
            const vendor = typeof info.usbVendorId === 'number' ? '0x' + info.usbVendorId.toString(16).padStart(4, '0') : 'Unknown';
            const product = typeof info.usbProductId === 'number' ? '0x' + info.usbProductId.toString(16).padStart(4, '0') : 'Unknown';

            const safeIndex = index;
            return `
                <tr>
                    <td class="px-4 py-2 text-gray-800">${vendor}</td>
                    <td class="px-4 py-2 text-gray-800">${product}</td>
                    <td class="px-4 py-2">
                        <button data-index="${safeIndex}" class="select-port-btn bg-green-600 hover:bg-green-700 text-white text-xs font-semibold py-1 px-3 rounded-lg">Use as Preferred</button>
                    </td>
                </tr>
            `;
        }));

        body.innerHTML = rows.join('');

        body.querySelectorAll('.select-port-btn').forEach(btn => {
            btn.addEventListener('click', async (event) => {
                const idx = Number(event.currentTarget.getAttribute('data-index'));
                const portsAgain = await navigator.serial.getPorts();
                const port = portsAgain[idx];
                if (!port) return;

                let info = {};
                try {
                    info = port.getInfo ? port.getInfo() : {};
                } catch {
                    info = {};
                }

                const vendorId = typeof info.usbVendorId === 'number' ? info.usbVendorId : null;
                const productId = typeof info.usbProductId === 'number' ? info.usbProductId : null;

                try {
                    const existingRaw = localStorage.getItem('preferred_scale_ids');
                    const existing = existingRaw ? JSON.parse(existingRaw) : [];
                    const combined = Array.isArray(existing) ? existing : [];

                    const already = combined.some(item => item && item.usbVendorId === vendorId && item.usbProductId === productId);
                    if (!already) {
                        combined.push({ usbVendorId: vendorId, usbProductId: productId });
                    }

                    localStorage.setItem('preferred_scale_ids', JSON.stringify(combined));
                    toast('Preferred scale port saved.', { type: 'success', duration: 5000 });
                } catch (err) {
                    console.error('Error saving preferred port:', err);
                    toast('Failed to save preferred port. See console for details.', { type: 'error', duration: 5000 });
                }
            });
        });
    } catch (error) {
        console.error('Error listing ports:', error);
        body.innerHTML = '<tr><td colspan="3" class="px-4 py-4 text-center text-red-600 text-sm">Failed to list ports. See console for details.</td></tr>';
    }
}

const PREFERRED_SCALE_IDS = [
    { usbVendorId: 0x0557, usbProductId: 0x2008 },
    { usbVendorId: 0x0557, usbProductId: 0x2011 },
];

async function requestNewPort() {
    if (!('serial' in navigator)) {
        toast('Web Serial API is not supported in this environment.', { type: 'error', duration: 5000 });
        return;
    }

    try {
        try {
            await navigator.serial.requestPort({ filters: PREFERRED_SCALE_IDS });
        } catch (err) {
            if (err && err.name === 'NotFoundError') {
                await navigator.serial.requestPort();
            } else {
                throw err;
            }
        }
        await listPorts();
    } catch (error) {
        if (error && error.name === 'AbortError') {
            // user cancelled; no message needed
            return;
        }
        console.error('Error requesting port:', error);
        const name = error && typeof error.name === 'string' ? error.name : 'Error';
        const message = error && typeof error.message === 'string' ? error.message : '';
        toast(`Failed to request a new port (${name})${message ? `: ${message}` : ''}. See console for details.`, { type: 'error', duration: 5000 });
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const refreshBtn = document.getElementById('refresh-btn');
    const requestBtn = document.getElementById('request-btn');

    if ('serial' in navigator) {
        try {
            navigator.serial.addEventListener('connect', () => listPorts());
            navigator.serial.addEventListener('disconnect', () => listPorts());
        } catch {
        }
    }

    refreshBtn?.addEventListener('click', () => {
        runAsync(() => listPorts(), {
            loadingMessage: 'Refreshing port list...',
            button: refreshBtn,
            buttonLoadingText: 'Refreshing...',
            errorToast: false,
        }).catch(() => {
            toast('Failed to refresh port list.', { type: 'error', duration: 5000 });
        });
    });

    requestBtn?.addEventListener('click', () => {
        runAsync(() => requestNewPort(), {
            loadingMessage: 'Requesting port access...',
            button: requestBtn,
            buttonLoadingText: 'Requesting...',
            errorToast: false,
        }).catch(() => {
            toast('Failed to request port access.', { type: 'error', duration: 5000 });
        });
    });

    runAsync(() => listPorts(), {
        loadingMessage: 'Loading available ports...',
        errorToast: false,
    }).catch(() => {
        toast('Failed to load available ports.', { type: 'error', duration: 5000 });
    });
});
