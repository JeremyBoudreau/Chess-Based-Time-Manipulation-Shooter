"use client";

import { useEffect, useState } from "react";
import { DATE_FORMAT, formatDateUtc } from "@/lib/format";

/** No `timeZone`, so the browser formats in the viewer's own zone. */
const localDateFormatter = new Intl.DateTimeFormat("en", DATE_FORMAT);

/**
 * A timestamp in the viewer's time zone. Server components only know the server's zone, so the
 * first render (server and hydration alike) shows the labelled UTC text, and the local time is
 * swapped in after mount; rendering it directly would mismatch during hydration.
 */
export function LocalTime({ iso }: { readonly iso: string }) {
  const [text, setText] = useState(() => formatDateUtc(new Date(iso)));

  useEffect(() => {
    setText(localDateFormatter.format(new Date(iso)));
  }, [iso]);

  return <time dateTime={iso}>{text}</time>;
}
