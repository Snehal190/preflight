"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";

/** Starts a new chat booking (one booking per chat). */
export default function NewChat() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/chat/${nanoid()}`);
  }, [router]);
  return null;
}
