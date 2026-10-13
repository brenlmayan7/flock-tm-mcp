import { makeRoute } from "@/lib/handler";

export const maxDuration = 60;
const route = makeRoute("tm", true);
export { route as GET, route as POST, route as DELETE };
