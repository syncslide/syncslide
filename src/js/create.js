document.getElementById("joinForm").addEventListener("submit", function(event) {
event.preventDefault();
let code = document.getElementById("code").value.trim();
if (code) {
window.location.href = window.location.origin + window.location.pathname + "/" + encodeURIComponent(code);
}
});
