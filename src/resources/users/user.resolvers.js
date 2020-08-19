const userResolver = {
  Query: {
    me() {
      return {
        _id: '2',
        name: 'Iduart',
        email: 'iduartdean@gmail.com',
        createdAt: 'ayer',
        updatedAt: 'hoy',
      }
    }
  }
}

module.exports = userResolver;