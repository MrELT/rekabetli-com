import { unstable_cache } from "next/cache";
import { fetchHomeBentoPayload, type HomeBentoPayload } from "@/lib/home-bento";

export function getCachedHomeBentoPayload(): Promise<HomeBentoPayload | null> {
  return unstable_cache(
    async () => fetchHomeBentoPayload(),
    ["rekabetli-home-bento-v1"],
    { revalidate: 60 },
  )();
}
