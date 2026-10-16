// Runs before the application so even syntax/module errors have a visible report.
(function () {
  try {
    var theme = localStorage.getItem('franka-theme');
    document.documentElement.dataset.theme = ['light','dark','system'].indexOf(theme) >= 0 ? theme : 'system';
  } catch (_) { document.documentElement.dataset.theme = 'system'; }
  var complete = false;
  var timer = setTimeout(function () {
    fail('Запуск занял слишком много времени. Проверьте доступ к хранилищу браузера и обновите страницу.');
  }, 20000);
  function finish() { complete = true; clearTimeout(timer); }
  function fail(message) {
    if (complete) return;
    finish();
    function show() {
      var root = document.getElementById('app');
      if (!root) return;
      root.replaceChildren();
      var panel = document.createElement('main');
      panel.style.cssText = 'max-width:760px;margin:40px auto;padding:24px;font:16px/1.6 system-ui;color:#1a1d21;background:#f4f4f0;border-radius:16px';
      var title = document.createElement('h1'); title.textContent = 'Не удалось запустить приложение';
      var text = document.createElement('p'); text.textContent = String(message);
      var help = document.createElement('p'); help.textContent = 'Обновите страницу. Если ошибка повторится, пришлите текст выше. Данные не удалены.';
      var button = document.createElement('button'); button.textContent = 'Повторить запуск'; button.onclick = function () { location.reload(); };
      panel.append(title, text, help, button); root.append(panel);
    }
    if (document.getElementById('app')) show();
    else document.addEventListener('DOMContentLoaded', show, {once:true});
  }
  window.__frankaBoot = { finish: finish, fail: fail };
  window.addEventListener('error', function (e) { if (e.message) fail(e.message); });
  window.addEventListener('unhandledrejection', function (e) { fail(e.reason && e.reason.message || e.reason || 'Ошибка запуска'); });
})();
