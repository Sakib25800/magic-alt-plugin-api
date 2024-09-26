export interface Env {
	AI: Ai;
}

interface RequestBody {
	images: string[];
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/generate-alt-text' && request.method === 'POST') {
			return handleAltTextGeneration(request, env);
		}

		return new Response('Not Found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;

async function handleAltTextGeneration(request: Request, env: Env): Promise<Response> {
	try {
		const body: RequestBody = await request.json();

		if (!body.images || !Array.isArray(body.images)) {
			return new Response('Invalid request body', { status: 400 });
		}

		const altTexts = await Promise.all(
			body.images.map(async (image) => {
				const imageResponse = await fetch(image);
				if (!imageResponse.ok) {
					throw new Error(`Failed to fetch image from ${image}`);
				}

				const imageBuffer = await imageResponse.arrayBuffer();

				const input = {
					image: [...new Uint8Array(imageBuffer)],
					prompt: `You are an expert in assistive technology. You will analyze the image and generate an alt text description for the image no longer than a sentence or two. Consider:
					- The subject(s) in detail
					- The setting
					- The actions or interactions
					- Other relevant information`,
				};

				const response = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', input);

				return { caption: response.description, image };
			}),
		);

		return new Response(JSON.stringify({ altTexts }), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Unknown error';
		return new Response('Error processing request: ' + message, { status: 500 });
	}
}
