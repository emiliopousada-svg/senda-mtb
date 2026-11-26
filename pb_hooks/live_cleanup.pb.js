// Borra del servidor las posiciones en vivo que llevan más de 5 minutos sin actualizarse.
// Evita que el último punto de alguien (con la app cerrada o sin cobertura) quede guardado y consultable.
// Se ejecuta cada minuto.
cronAdd("limpiar_live_locations", "* * * * *", () => {
  $app.db()
    .newQuery("DELETE FROM live_locations WHERE datetime(updated) < datetime('now', '-5 minutes')")
    .execute();
});
