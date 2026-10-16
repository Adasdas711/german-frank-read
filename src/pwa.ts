// Keep standalone file:// usage working; installation needs HTTPS or localhost.
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  const register = () => {
    void navigator.serviceWorker
      .register("./sw.js", { updateViaCache: "none" })
      .catch((error) =>
        console.warn("Offline installation unavailable", error),
      );
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
