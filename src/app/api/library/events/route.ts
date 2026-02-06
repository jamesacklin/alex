import { getLibraryVersion } from "@/lib/db/library-version";

export const dynamic = "force-dynamic";

// Server-Sent Events endpoint for real-time library updates
export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let lastVersion = await getLibraryVersion();
      let isActive = true;

      // Send initial connection message
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "connected" })}\n\n`)
      );

      // Poll for library version changes every 2 seconds
      const checkForUpdates = async () => {
        if (!isActive) return;

        try {
          const currentVersion = await getLibraryVersion();

          if (currentVersion !== lastVersion) {
            lastVersion = currentVersion;
            const data = JSON.stringify({
              type: "library-update",
              timestamp: currentVersion,
            });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }
        } catch (error) {
          // Silently handle errors
        }
      };

      // Check for updates every 2 seconds
      const updateTimer = setInterval(checkForUpdates, 2000);

      // Send keepalive every 15 seconds
      const keepaliveTimer = setInterval(() => {
        if (!isActive) return;
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          isActive = false;
          clearInterval(updateTimer);
          clearInterval(keepaliveTimer);
        }
      }, 15000);

      return () => {
        isActive = false;
        clearInterval(updateTimer);
        clearInterval(keepaliveTimer);
      };
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
