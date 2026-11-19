"use client";
import { useEffect } from "react";
import { listenForErrors } from "@/lib/telemetry/report";

/** Reports errors that nothing on the page caught. Renders nothing. */
export default function ErrorReporter() {
  useEffect(() => listenForErrors(), []);
  return null;
}
