export interface Env {
	AI: Ai;
}

interface RequestBody {
	images: string[];
	siteUrl: string;
}

const ALLOWED_ORIGINS = ['https://localhost:5173', 'https://magic-alt-plugin.pages.dev'];

function corsHeaders(origin: string) {
	return {
		'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
		'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
	};
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const origin = request.headers.get('Origin') || '';

		if (request.method === 'OPTIONS' && url.pathname === '/generate-alt-text') {
			return new Response(null, {
				headers: corsHeaders(origin),
			});
		}

		if (url.pathname === '/generate-alt-text' && request.method === 'POST') {
			const response = await handleAltTextGeneration(request, env);
			Object.entries(corsHeaders(origin)).forEach(([key, value]) => {
				response.headers.set(key, value);
			});
			return response;
		}

		return new Response('Not Found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;

async function fetchSiteData(url: string): Promise<{ title: string; description: string }> {
	const response = await fetch(url);
	const html = await response.text();

	const titleMatch = html.match(/<title>(.*?)<\/title>/i);
	const descriptionMatch = html.match(/<meta\s+name="description"\s+content="(.*?)"/i);

	return {
		title: titleMatch ? titleMatch[1] : '',
		description: descriptionMatch ? descriptionMatch[1] : '',
	};
}

async function handleAltTextGeneration(request: Request, env: Env): Promise<Response> {
	try {
		const body: RequestBody = await request.json();

		if (!body.images || !Array.isArray(body.images) || !body.siteUrl) {
			return new Response('Invalid request body', {
				status: 400,
				headers: corsHeaders(request.headers.get('Origin') || ''),
			});
		}

		const siteData = await fetchSiteData(body.siteUrl);

		const altTexts = await Promise.all(
			body.images.map(async (image) => {
				try {
					const imageResponse = await fetch(image);
					if (!imageResponse.ok) {
						throw new Error(`Failed to fetch image from ${image}`);
					}

					const imageBuffer = await imageResponse.arrayBuffer();

					const input = {
						image: [...new Uint8Array(imageBuffer)],
						prompt: `
						You are an expert in assistive technology. You will analyze the image and generate an alt text description for the image no longer than a sentence or two.

						Guidelines:
						    - Use simple present tense (e.g., "Cat sits on sofa" not "Cat is sitting on sofa")
                            - Remain objective and factual
                            - Maintain relevance to the page content

						Consider:
                            1. The subject(s) in detail
                            2. The setting
                            3. The actions or interactions
                            4. Other relevant information
                            5. Take into consideration the site data for better context

                        Avoid:
                            - Unnecessary details
                            - Subjective interpretations
                            - Redundant information
                            - Focussing on other features apart from the subject in detail
                            - Using 'is' and 'are'

                        Use the following site data for context:
                            URL: ${body.siteUrl}
                            Title: ${siteData.title}
                            Description: ${siteData.description}

                        Provide only the alt text description, without additional commentary.
						`,
						max_tokens: 35,
					};

					const response = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', input);

					return { caption: response.description.trimStart(), image, error: null };
				} catch (e) {
					console.error(e);
					let errorMessage = 'Unknown error occurred';

					if (e instanceof Error) {
						if (e.name === 'InferenceError') {
							errorMessage = 'AI inference failed';
						} else {
							errorMessage = e.message;
						}
					}

					return { caption: '', image, error: errorMessage };
				}
			}),
		);

		const errors = altTexts.filter((img) => img.error !== null);

		return new Response(
			JSON.stringify({
				data: altTexts,
				error: errors.length > 0 ? { message: 'Failed to process some images' } : null,
			}),
			{
				headers: {
					'Content-Type': 'application/json',
					...corsHeaders(request.headers.get('Origin') || ''),
				},
			},
		);
	} catch (e) {
		console.error('Error processing request:', e);
		const message = e instanceof Error ? e.message : 'Unknown error';
		return new Response('Error processing request: ' + message, {
			status: 500,
			headers: corsHeaders(request.headers.get('Origin') || ''),
		});
	}
}
