const pid = window.location.pathname.split('/').pop();

const wsUrl = new URL(`/ws/${pid}`, window.location.href);
wsUrl.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const socket = new WebSocket(wsUrl.href);
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

