
import { NextResponse } from "next/server";
import { detectFrame } from "@/lib/yolo-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    try {
        const body = await request.json();

        const frameId = body.frameId;
        const image = body.image;

        if (
            typeof frameId !== "number" ||
            typeof image !== "string" ||
            !image.startsWith("data:image/")
        ) {
            return NextResponse.json(
                { success: false, error: "Invalid frame payload" },
                { status: 400 }
            );
        }

        const result = await detectFrame(frameId, image);

        return NextResponse.json(result);
    } catch (error) {
        console.error("[offline-detect]", error);

        return NextResponse.json(
            {
                success: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Detection failed",
            },
            { status: 500 }
        );
    }
}
