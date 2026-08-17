import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveCommunityApiAuth, sameUserId } from "@/lib/community/auth-server";
import {
  buildCommunityNotalCorpus,
  COMMUNITY_NOTAL_LIMITS,
  generateCommunityNotalFaqs,
  generateCommunityNotalSummary,
  type CommunityNotalMode,
} from "@/lib/community/notal-summary";

export const runtime = "nodejs";
export const maxDuration = 60;

const COMMUNITY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

async function userCanViewCommunity(
  supabase: SupabaseClient,
  communityId: string,
  userId: string,
  ownerId: string | null,
): Promise<boolean> {
  if (sameUserId(ownerId, userId)) return true;

  const { data: member } = await supabase
    .from("community_members")
    .select("user_id")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();

  return Boolean(member?.user_id);
}

export async function POST(request: Request) {
  const auth = await resolveCommunityApiAuth(request);
  if (!auth) return jsonError("auth_required", 401);

  if (!process.env.OPENAI_API_KEY?.trim()) {
    return jsonError("openai_not_configured", 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("invalid_json", 400);
  }

  const bodyObj =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const communityId =
    typeof bodyObj.communityId === "string" ? bodyObj.communityId.trim() : "";
  const modeRaw = bodyObj.mode;
  const mode: CommunityNotalMode | null =
    modeRaw === "summary" || modeRaw === "faq" ? modeRaw : null;

  if (!COMMUNITY_ID_PATTERN.test(communityId) || !mode) {
    return jsonError("invalid_payload", 400);
  }

  const { data: community, error: communityError } = await auth.supabase
    .from("communities")
    .select("id, owner_id, name, purpose")
    .eq("id", communityId)
    .maybeSingle();

  if (communityError || !community) {
    return jsonError("community_not_found", 404);
  }

  const allowed = await userCanViewCommunity(
    auth.supabase,
    communityId,
    auth.user.id,
    community.owner_id,
  );
  if (!allowed) return jsonError("forbidden", 403);

  const { data: postRows, error: postsError } = await auth.supabase
    .from("posts")
    .select("id, title, content")
    .eq("community_id", communityId)
    .order("created_at", { ascending: false })
    .limit(COMMUNITY_NOTAL_LIMITS.MAX_POSTS);

  if (postsError) {
    console.error("[community-notal] posts:", postsError.message);
    return jsonError("load_failed", 500);
  }

  const posts = postRows ?? [];
  const postIds = posts.map((row) => row.id);
  const commentsByPostId = new Map<string, string[]>();

  if (postIds.length) {
    const { data: commentRows, error: commentsError } = await auth.supabase
      .from("comments")
      .select("post_id, content")
      .in("post_id", postIds)
      .order("created_at", { ascending: false })
      .limit(COMMUNITY_NOTAL_LIMITS.MAX_COMMENTS);

    if (commentsError) {
      console.error("[community-notal] comments:", commentsError.message);
    } else {
      for (const row of commentRows ?? []) {
        const postId = typeof row.post_id === "string" ? row.post_id : "";
        const content = typeof row.content === "string" ? row.content : "";
        if (!postId || !content) continue;
        const list = commentsByPostId.get(postId) ?? [];
        if (list.length >= 8) continue;
        list.push(content);
        commentsByPostId.set(postId, list);
      }
    }
  }

  const corpus = buildCommunityNotalCorpus({
    name: community.name,
    purpose: community.purpose,
    posts,
    commentsByPostId,
  });

  try {
    if (mode === "faq") {
      const result = await generateCommunityNotalFaqs(corpus);
      return Response.json({
        ok: true,
        mode,
        faqs: result.faqs,
      });
    }

    const result = await generateCommunityNotalSummary(corpus);
    return Response.json({
      ok: true,
      mode,
      summary: result.summary,
      highlights: result.highlights,
    });
  } catch (error) {
    console.error("[community-notal] generate:", error);
    return jsonError("generation_failed", 502);
  }
}
