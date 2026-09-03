// Base URL for the Go backend's HTTP API (avatar upload/serve).
// Empty string means same-origin, which is how production works: the Go
// server serves the exported frontend and the API on the same port. In hot
// dev mode the frontend runs on its own port, so set
// NEXT_PUBLIC_API_BASE (e.g. http://localhost:3000) in the environment.
export const API_BASE: string = process.env.NEXT_PUBLIC_API_BASE ?? "";
