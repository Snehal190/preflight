import { Suspense } from "react";
import View from "./View";

// The view reads URL params and browser storage, so it renders on the client inside Suspense.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <View />
    </Suspense>
  );
}
