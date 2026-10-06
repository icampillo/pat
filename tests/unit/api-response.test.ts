import { expect, it } from 'vitest';
import { readApiResponse } from '@/components/workspace/api';

it.each(['An error occurred', '<html>Error</html>', '', 'null', '{}'])(
  'handles invalid API envelopes without leaking parser errors: %s',
  async (body) => {
    await expect(
      readApiResponse(new Response(body, { status: 502 }), 'Indisponible'),
    ).rejects.toThrow('Indisponible (HTTP 502)');
    await expect(readApiResponse(new Response(body), 'Confirmation indisponible')).rejects.toThrow(
      'Confirmation indisponible (HTTP 200)',
    );
  },
);
it('preserves business errors and explains expired sessions even without JSON', async () => {
  await expect(
    readApiResponse(
      Response.json(
        {
          error: { message: 'La ressource a changé. Rechargez la page.' },
        },
        { status: 412 },
      ),
      'Indisponible',
    ),
  ).rejects.toThrow('La ressource a changé.');
  await expect(readApiResponse(new Response('', { status: 401 }), 'Indisponible')).rejects.toThrow(
    'Votre session a expiré.',
  );
});
