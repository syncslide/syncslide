const parts = window.location.pathname.split('/').filter(Boolean);
const pid = parts[parts.length - 1] === 'edit'
    ? parts[parts.length - 2]
    : parts[parts.length - 1];

const wsUrl = new URL(`/ws/${pid}`, window.location.href);
wsUrl.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

// Mutable socket reference — reassigned on each reconnect attempt.
// var (not let/const) at top-level so window.socket is accessible from tests
// and from other scripts that reference the global socket name.
var socket;

// Registered onmessage handler — re-applied to every new socket after reconnect.
let _wsMessageHandler = null;

let _wsReconnectDelay = 1000;
const _wsMaxDelay = 30000;

/**
 * Register the onmessage handler and open the first connection.
 * Must be called instead of socket.onmessage = directly, so the handler
 * survives reconnections. The initial _wsConnect() is deferred to this call
 * so the handler is guaranteed to be set before any messages arrive.
 */
function wsRegisterMessageHandler(fn) {
    _wsMessageHandler = fn;
    if (socket) {
        socket.onmessage = fn;
    } else {
        _wsConnect();
    }
}

function _wsSetStatus(connected) {
    const el = document.getElementById('ws-status');
    if (!el) return;
    if (connected) {
        el.hidden = true;
        el.textContent = '';
    } else {
        el.hidden = false;
        el.textContent = 'Connection lost \u2014 reconnecting\u2026';
    }
}

function _wsConnect() {
    socket = new WebSocket(wsUrl.href);
    if (_wsMessageHandler) socket.onmessage = _wsMessageHandler;

    socket.onopen = function () {
        _wsReconnectDelay = 1000;
        _wsSetStatus(true);
    };

    socket.onclose = function () {
        _wsSetStatus(false);
        const jitter = Math.random() * 500;
        const delay = _wsReconnectDelay + jitter;
        _wsReconnectDelay = Math.min(_wsReconnectDelay * 2, _wsMaxDelay);
        setTimeout(_wsConnect, delay);
    };

    socket.onerror = function () {
        // onerror is always followed by onclose; reconnection is handled there.
    };
}

const md = new remarkable.Remarkable({
	html: true,
});

function addSiblings(allHtml) {
	const h2s = allHtml.querySelectorAll('h2');
	const result = [];
	h2s.forEach(h2 => {
		const siblings = [h2];
		let sibling = h2.nextElementSibling;
		while (sibling && sibling.tagName !== 'H2') {
			siblings.push(sibling);
			sibling = sibling.nextElementSibling;
		}

		result.push(siblings);
	});
	return result;
}

const updateRender = async () => {
	const htmlDiv = document.getElementById("currentSlide");
	renderMathInElement(htmlDiv, {
		delimiters: [
			{left: "$$", right: "$$", display: true},
			{left: "$", right: "$", display: false}
		],
		throwError: false,
	});
}
