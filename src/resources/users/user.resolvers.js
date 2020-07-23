const userResolver = {
  Query: {
    me() {
      return {
        id: '2',
        name: 'Iduart',
        createdAt: 'ayer',
        updatedAt: 'hoy',
      }
    }
  }
}

module.exports = userResolver;