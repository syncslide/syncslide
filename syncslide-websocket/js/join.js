document.getElementById("joinForm").addEventListener("submit", function(event) {
event.preventDefault();
let uname = document.getElementById("uname").value.trim();
let code = document.getElementById("code").value.trim();
if (code) {
window.location.href =
	window.location.origin + "/" +
	encodeURIComponent(uname) + "/" +
	encodeURIComponent(code);
}
});
