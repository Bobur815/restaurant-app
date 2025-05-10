
fetch('../html/customAlert.html')
  .then(res => res.text())
  .then(html => {
    document.getElementById('alert-placeholder').innerHTML = html;
  });
