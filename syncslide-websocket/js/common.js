const pid=window.location.href.substring(window.location.href.lastIndexOf("/")+1)

let port = window.location.port;
let port_spec = port === "" ? "" : ":" + port;
let host = window.location.hostname;
let secure = window.location.protocol === "https:";
let prefix = secure ? "wss://" : "ws://";
WEBSOCKET_ADDR = prefix + host + port_spec + "/ws/" + pid;
const socket = new WebSocket(WEBSOCKET_ADDR);
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

