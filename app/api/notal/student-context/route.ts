import { resolveNotalAuth } from "@/lib/notal/auth-server";
import { fetchStudentProfile } from "@/lib/notal/student-context-server";
import { readStudentProfileFromUserMeta } from "@/lib/notal/student-context";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const auth = await resolveNotalAuth(request);
  if (!auth) return jsonError("auth_required", 401);

  const profile =
    (await fetchStudentProfile(auth.user.id)) ??
    readStudentProfileFromUserMeta(
      (auth.user.user_metadata ?? {}) as Record<string, unknown>,
    );
  return Response.json({ context: profile });
}
