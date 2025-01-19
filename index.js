require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const port = process.env.PORT || 5000;
// const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nor5r.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const userCollection = client.db('TourismDB').collection('users');
    const storiesCollection = client.db('TourismDB').collection('stories');
    const packageCollection = client.db('TourismDB').collection('packages');
    const guideApplicationCollection = client.db('TourismDB').collection('guideApplications')

    // user related API

    app.get('/users', async(req, res) => {
      const email = req.query.email;
      try{
        if(email){
          const user = await userCollection.findOne({email});
          if(!user){
            return res.send({message: 'User not found'})
          }
          return res.send(user);
        }
        else{
          const users = await userCollection.find().toArray();
          return res.send(users);
        }
      }catch(error){
        console.log('Error fetching users:', error);
        res.send({message: 'failed to fetch users'})
      }
      
    })

    app.post('/users', async(req, res) => {
      const {name, email} = req.body;
      const query = {email: email};
      const existingUser = await userCollection.findOne(query);
      if(existingUser){
        return res.send({message: 'user already exist', insertedId: null})
      }
      const user = {name, email, role: 'tourist'}
      const result = await userCollection.insertOne(user);
      res.send(result);
    })

    // package related api
    app.get('/packages', async(req, res) => {
      const result = await packageCollection.find().toArray();
      res.send(result);
    })

    app.get('/packages/:id', async(req, res) => {
      const {id} = req.params;
      const query = {_id: new ObjectId(id)};
      const result = await packageCollection.findOne(query);
      res.send(result);
    })

    // guide application related APIs

    app.get('/guideApplications', async(req, res) => {
      const result = await guideApplicationCollection.find().toArray();
      res.send(result);
    })

    app.post('/guideApplications', async(req, res) => {
      const {userId, name, email, title, reason, cvLink} = req.body;
      console.log('post er userId',userId);

      const existingApplication = await guideApplicationCollection.findOne({userId: new ObjectId(userId)});
      if(existingApplication){
        return res.status(400).send({message: 'You have already applied to become a tour guide'})
      }

      const applicationData = {
        userId: new ObjectId(userId), name, email, title, reason, cvLink, status: 'pending', appliedAt: new Date()
      }

      const result = await guideApplicationCollection.insertOne(applicationData);
      res.send({message: 'Application Submitted Successfully', applicationId: result.insertedId})
    })

    app.put('/guideApplications/accept/:id', async(req, res) => {
      const {id} = req.params;
      console.log(id);
      try{
        const application = await guideApplicationCollection.findOne({_id: new ObjectId(id)});
      if(!application){
        return res.status(404).send({message: 'application not found'})
      }
      const {userId} = application;
      console.log('application er userid', userId);
      const updateUser = await userCollection.updateOne(
        {_id: new ObjectId(userId)},
        {$set: {role: 'tour-guide'}}
      )

      await guideApplicationCollection.deleteOne({_id: new ObjectId(id)});
      res.send({message: 'application accepted and role updated to tour-guide'})
      }
      catch(error){
        res.send({message: 'failed to accept invitation'})
      }

    })


    app.delete('/guideApplications/reject/:id', async(req, res) => {
      const {id} = req.params;
      const query = {_id: new ObjectId(id)};
      const result = await guideApplicationCollection.deleteOne(query);
      if(result.deletedCount === 0){
        return res.send({message: 'application not found'})
      }
      res.send({message: 'Application deleted and reject successfully'})
    })

    // stories related api
    app.get('/stories', async(req, res) => {
        const stories = await storiesCollection.find().toArray();
        res.send(stories);
    })

    
    
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('server running properly')
})

app.listen(port, () => {
    console.log(`server running on port: ${port}`);
})