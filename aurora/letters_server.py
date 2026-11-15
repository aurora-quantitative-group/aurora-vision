import asyncio
import base64

from aiohttp import web

from aurora.asl import classify_letters, load_letter_classifier


async def app() -> web.Application:
    classifier = await load_letter_classifier()
    lock = asyncio.Lock()

    async def translate(request: web.Request) -> web.Response:
        try:
            data = await request.json()
            frames = data["frames"]
            if not isinstance(frames, list) or not 3 <= len(frames) <= 24:
                raise ValueError("Provide between 3 and 24 frames")
            images = [base64.b64decode(frame["jpeg"], validate=True) for frame in frames[-5:]]
            async with lock:
                result = await asyncio.to_thread(classify_letters, images, classifier)
            return web.json_response(result.model_dump())
        except (ValueError, KeyError, TypeError, OSError):
            raise web.HTTPBadRequest(text="Invalid signing frames") from None

    application = web.Application(client_max_size=4 * 1024 * 1024)
    application.router.add_post("/translate", translate)

    async def close_classifier(application):
        await asyncio.to_thread(classifier.close)

    application.on_cleanup.append(close_classifier)
    return application


if __name__ == "__main__":
    web.run_app(app(), host="127.0.0.1", port=8090, access_log=None)
