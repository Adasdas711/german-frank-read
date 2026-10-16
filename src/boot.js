// Runs before the application so even syntax/module errors have a visible report.
(function () {
  try {
    var theme = localStorage.getItem("franka-theme");
    document.documentElement.dataset.theme =
      ["light", "dark", "system"].indexOf(theme) >= 0 ? theme : "dark";
  } catch (_) {
    document.documentElement.dataset.theme = "dark";
  }
  var de = false,
    en = true;
  try {
    var lang = localStorage.getItem("franka-language");
    de = lang === "de";
    en = lang !== "ru" && !de;
  } catch (_) {}
  document.documentElement.lang = de ? "de" : en ? "en" : "ru";
  function localized(ru, german, english) {
    return de
      ? german
      : en
        ? english ||
          "The app could not start. Reload this page. Your data has not been removed."
        : ru;
  }
  var complete = false;
  var timer = setTimeout(function () {
    fail(
      localized(
        "Запуск занял слишком много времени. Проверьте доступ к хранилищу браузера и обновите страницу.",
        "Der Start dauert zu lange. Prüfe den Zugriff auf den Browserspeicher und lade die Seite neu.",
      ),
    );
  }, 20000);
  function finish() {
    complete = true;
    clearTimeout(timer);
  }
  function fail(message) {
    if (complete) return;
    finish();
    function show() {
      var root = document.getElementById("app");
      if (!root) return;
      root.replaceChildren();
      var panel = document.createElement("main");
      panel.style.cssText =
        "max-width:760px;margin:40px auto;padding:24px;font:16px/1.6 system-ui;color:#1a1d21;background:#f4f4f0;border-radius:16px";
      var title = document.createElement("h1");
      title.textContent = localized(
        "Не удалось запустить приложение",
        "Die Anwendung konnte nicht gestartet werden",
      );
      var text = document.createElement("p");
      text.textContent = String(message);
      var help = document.createElement("p");
      help.textContent = localized(
        "Обновите страницу. Если ошибка повторится, пришлите текст выше. Данные не удалены.",
        "Lade die Seite neu. Falls der Fehler erneut auftritt, sende den obigen Text. Die Daten wurden nicht gelöscht.",
      );
      var button = document.createElement("button");
      button.textContent = localized(
        "Повторить запуск",
        "Erneut versuchen",
        "Try again",
      );
      button.onclick = function () {
        location.reload();
      };
      panel.append(title, text, help, button);
      root.append(panel);
    }
    if (document.getElementById("app")) show();
    else document.addEventListener("DOMContentLoaded", show, { once: true });
  }
  window.__frankaBoot = { finish: finish, fail: fail };
  window.addEventListener("error", function (e) {
    if (e.message) fail(e.message);
  });
  window.addEventListener("unhandledrejection", function (e) {
    fail(
      (e.reason && e.reason.message) ||
        e.reason ||
        localized("Ошибка запуска", "Fehler beim Start"),
    );
  });
})();
