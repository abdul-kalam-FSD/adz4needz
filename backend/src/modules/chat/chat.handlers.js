export function createChatHandlers({ chatService }) {
  return {
    async members(req, res) { res.status(200).json(await chatService.members(req.user)); },
    async list(req, res) { res.status(200).json(await chatService.list(req.user, req.query)); },
    async unread(req, res) { res.status(200).json(await chatService.unread(req.user)); },
    async send(req, res) {
      const result = await chatService.send(req.user, req.body);
      res.status(result.duplicate ? 200 : 201).json(result); // 200 = "already sent", nothing was posted twice
    },
    async read(req, res) { res.status(200).json(await chatService.markRead(req.user, req.body)); }
  };
}
