import request from 'supertest';
import { app } from './index'; // import your Express app

describe('GET /api/user_project_file', () => {
  it('should require a URI', async () => {
    const res = await request(app).get('/api/user_project_file');
    expect(res.statusCode).toEqual(400);
    expect(res.text).toContain('URI is required');
  });

  // Add more tests as needed
});

// Write similar tests for other endpoints
