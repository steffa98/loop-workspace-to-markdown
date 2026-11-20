// Runs in Loop's print view before Loop's own scripts (document_start, page world).
// Loop opens the browser's print dialog there, which would freeze the tab while its content is copied.
window.print = () => {};
