export function onRequest() {
  return Response.json({status:'NOT_FOUND', error:'API endpoint not found.'}, {status:404, headers:{'Cache-Control':'no-store'}});
}
