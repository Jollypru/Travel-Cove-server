require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const multer = require('multer');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const port = process.env.PORT || 5000;
const path = require('path');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`)
  }
})
const upload = multer({ storage });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));



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
    // await client.connect();

    const userCollection = client.db('TourismDB').collection('users');
    const storiesCollection = client.db('TourismDB').collection('stories');
    const packageCollection = client.db('TourismDB').collection('packages');
    const guideApplicationCollection = client.db('TourismDB').collection('guideApplications')
    const bookingsCollection = client.db('TourismDB').collection('bookings')

    app.post('/jwt', async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '5h' });
      res.send({ token });
    })

    // middlewares
    const verifyToken = (req, res, next) => {
      // console.log('inside verify token',req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: 'unauthorized access' });
      }
      const token = req.headers.authorization.split(' ')[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (error, decoded) => {
        if (error) {
          return res.status(401).send({ message: 'unauthorized access' })
        }
        req.decoded = decoded;
        next();
      })
    }

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === 'admin';
      if (!isAdmin) {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next();
    }

    // user related API

    app.get('/users', async (req, res) => {
      const { name, email, role } = req.query;

      try {
        const query = {};
        if (email) {
          query.email = { $regex: email, $options: 'i' };
        }

        if (name) {
          query.name = { $regex: name, $options: 'i' };
        }
        if (role) {
          query.role = role;
        }

        const users = await userCollection.find(query).toArray();
        res.send(users.length === 1 ? users[0] : users);
      } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).send({ message: 'Failed to fetch users' });
      }
    });


    // for admin verification
    app.get('/users/admin/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: 'forbidden access' })
      }
      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === 'admin'
      }
      res.send({ admin });
    })

    // made a specific user admin
    app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: 'admin'
        }
      }
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    })

    // new user register
    app.post('/users', async (req, res) => {
      const { name, email, photo, role } = req.body;
      const query = { email: email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: 'user already exist', insertedId: null })
      }
      const addUser = { name, email, photo, role: role || 'tourist', createdAt: new Date() }
      const result = await userCollection.insertOne(addUser);
      res.send(result);
    })

    app.get('/admin/stats', async (req, res) => {
      const totalPayment = await bookingsCollection.aggregate([
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]).toArray();

      const totalTourGuides = await userCollection.countDocuments({ role: 'tour-guide' });
      const totalPackages = await packageCollection.countDocuments();
      const totalClients = await userCollection.countDocuments({ role: 'tourist' });
      const totalStories = await storiesCollection.countDocuments();

      res.send({
        totalPayment: totalPayment[0]?.total || 0,
        totalTourGuides,
        totalPackages,
        totalClients,
        totalStories,
      });
    });

    const isValidObjectId = (id) => {
      return ObjectId.isValid(id) && String(new ObjectId(id)) === id;
    };


    // to get tour-guide list
    app.get('/users/:id', async (req, res) => {
      const id = req.params.id;
      if (!isValidObjectId(id)) {
        return res.status(400).send({ message: 'Invalid ID format' });
      }
      const query = { _id: new ObjectId(id), role: 'tour-guide' };
      const result = await userCollection.findOne(query);

      if (!result) {
        return req.send({ message: 'guide not found' });
      }
      res.send(result);
    })


    // manage profile of user
    app.patch('/users/profile/:id', verifyToken, async (req, res) => {
      const { id } = req.params;
      const { name, photo } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          name, photo, updatedAt: new Date()
        }
      }
      const result = await userCollection.updateOne(filter, updatedDoc);
      if (result.matchedCount === 0) {
        return res.status(404).send({ message: 'User not found' });
      }
      res.send({ message: 'Profile updated successfully.' });
    })

    // package related api
    app.get('/packages', async (req, res) => {
      const result = await packageCollection.find().toArray();
      res.send(result);
    })

    app.get('/packages/random', async (req, res) => {
      try {
        const randomPackages = await packageCollection.aggregate([{ $sample: { size: 3 } }]).toArray();
        res.send(randomPackages);
      } catch (error) {
        console.error('Error fetching random packages:', error);
        res.status(500).send({ message: 'Failed to fetch random packages' });
      }
    });

    app.get('/packages/:id', async (req, res) => {
      const id = req.params.id;
      if (!isValidObjectId(id)) {
        return res.status(400).send({ message: 'Invalid package ID.' })
      }
      try {
        const package = await packageCollection.findOne({ _id: new ObjectId(id) });
        if (!package) {
          return res.status(404).send({ message: 'Package not found.' })
        }
        res.send(package);
      }
      catch (error) {
        console.error('Error fetching package', error);
        res.send({ message: 'failed to fetch package.' })
      }
    })



    app.post('/packages', upload.fields([
      { name: 'coverImage', maxCount: 1 },
      { name: 'galleryImages', maxCount: 10 }
    ]), async (req, res) => {
      const { title, description, price, tourPlan, tourType } = req.body;
      const coverImage = req.files?.coverImage?.[0]?.path;
      const galleryImages = req.files?.galleryImages?.map(file => file.path);

      const newPackage = {
        title, description, price: parseFloat(price), tourPlan: JSON.parse(tourPlan), tourType, coverImage, galleryImages, createdAt: new Date()
      }
      const result = await packageCollection.insertOne(newPackage);
      res.send({ message: 'Package added successfully', packageId: result.insertedId })
    })


    // guide related api

    app.get('/guides', async (req, res) => {
      const query = { role: 'tour-guide' };
      const guides = await userCollection.find(query).toArray();
      res.send(guides);
    })

    app.get('/guides/random', async (req, res) => {
      try {
        const randomGuides = await userCollection.aggregate([
          { $match: { role: 'tour-guide' } }, // Ensure only tour guides are included
          { $sample: { size: 6 } }
        ]).toArray();
        res.send(randomGuides);
      } catch (error) {
        console.error('Error fetching random tour guides:', error);
        res.status(500).send({ message: 'Failed to fetch random tour guides' });
      }
    });

    // guide application related APIs

    app.get('/guideApplications', async (req, res) => {
      const result = await guideApplicationCollection.find().toArray();
      res.send(result);
    })

    app.post('/guideApplications', async (req, res) => {
      const { name, email, title, reason, cvLink } = req.body;
      const applicationData = {
        name, email, title, reason, cvLink, status: 'pending', appliedAt: new Date()
      }

      const result = await guideApplicationCollection.insertOne(applicationData);
      res.send({ message: 'Application Submitted Successfully', applicationId: result.insertedId })
    })

    app.put('/guideApplications/accept/:id', async (req, res) => {
      const { id } = req.params;
      console.log(id);
      try {
        const application = await guideApplicationCollection.findOne({ _id: new ObjectId(id) });
        if (!application) {
          return res.status(404).send({ message: 'application not found' })
        }
        const { userId } = application;
        // console.log('application er userid', userId);
        const updateUser = await userCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { role: 'tour-guide' } }
        )

        await guideApplicationCollection.deleteOne({ _id: new ObjectId(id) });
        res.send({ message: 'application accepted and role updated to tour-guide' })
      }
      catch (error) {
        res.send({ message: 'failed to accept invitation' })
      }

    })


    app.delete('/guideApplications/reject/:id', async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await guideApplicationCollection.deleteOne(query);
      if (result.deletedCount === 0) {
        return res.send({ message: 'application not found' })
      }
      res.send({ message: 'Application deleted and reject successfully' })
    })

    // stories related api
    app.get('/stories', async (req, res) => {
      const { email } = req.query;
      try {
        let query = {};
        if (email) {
          query = { email: email }
        }
        const stories = await storiesCollection.find(query).toArray();
        res.send(stories);
      } catch (error) {
        console.error('Error fetching stories:', error);
        res.status(500).send({ message: 'Failed to fetch stories' });
      }
    });

    app.get('/stories/random', async (req, res) => {
      try {
        const stories = await storiesCollection.aggregate([{ $sample: { size: 4 } }]).toArray();
        res.send(stories);
      } catch (error) {
        console.error('Error fetching random stories:', error);
        res.status(500).send({ message: 'Failed to fetch random stories' });
      }
    });

    app.post('/stories', upload.array('images', 5), async (req, res) => {
      try {
        const { title, description, userId } = req.body;
        const imageFiles = req.files.map((file) => file.path); // Save file paths

        if (!title || !description || !userId) {
          return res.status(400).send({ message: 'Title, description, and userId are required' });
        }

        const story = {
          title,
          description,
          userId: new ObjectId(userId),
          images: imageFiles,
          createdAt: new Date(),
        };

        const result = await storiesCollection.insertOne(story);
        res.send({ message: 'Story added successfully', storyId: result.insertedId });
      } catch (error) {
        console.error('Error adding story:', error);
        res.status(500).send({ message: 'Failed to add story' });
      }
    });

    app.delete('/stories/:id', async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await storiesCollection.deleteOne(query);
      if (result.deletedCount === 0) {
        return res.status(404).send({ message: 'Story not found' });
      }
      res.send({ message: 'Story deleted successfully' });
    });


    app.patch('/stories/:id', async (req, res) => {
      const { id } = req.params;
      const { addImages, removeImage } = req.body;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: 'Invalid ID format' });
      }

      const updateData = {
        $set: { lastUpdated: new Date() },
      };

      if (addImages && Array.isArray(addImages)) {
        updateData.$push = { images: { $each: addImages } };
      }
      if (removeImage) {
        updateData.$pull = { images: removeImage };
      }

      try {
        const query = { _id: new ObjectId(id) };
        const result = await storiesCollection.updateOne(query, updateData);

        if (result.modifiedCount === 0) {
          return res.status(404).send({ message: 'Story not found.' });
        }
        res.send({ message: 'Story updated successfully' });
      } catch (error) {
        console.error('Error updating story:', error);
        res.status(500).send({ message: 'Failed to update story' });
      }
    });


    // booking related api
    app.get('/bookings', async (req, res) => {
      const { email } = req.query;
      if (!email) {
        return res.status(400).send({ message: 'Email is required' })
      }
      const bookings = await bookingsCollection.find({ touristEmail: email }).toArray();
      res.send(bookings);
    })

    app.get('/bookings/:id', async(req, res) => {
      const {id} = req.params;
      const result = await bookingsCollection.findOne({_id: new ObjectId(id)});
      if(!result){
        return res.send({message: 'Booking not found'})

      }
      res.send(result)
    })

    app.post('/bookings', async (req, res) => {
      const { packageName, touristName, touristEmail, touristImage, price, tourDate, guideName, status = 'pending' } = req.body;

      if (!packageName || !touristName || !touristEmail || !tourDate || !price) {
        return res.status(400).send({ message: 'Missing required booking details' });
      }

      const booking = { packageName, touristName, touristEmail, touristImage, price, tourDate, guideName, status, createdAt: new Date() };
      const result = await bookingsCollection.insertOne(booking);
      res.send({ message: 'Booking created successfully.', bookingId: result.insertedId });
    })

    app.post('/create-payment-intent', async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      console.log(amount, 'amount inside the intent');

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'bdt',
        payment_method_types: ['card'], 
      })
      res.send({
        clientSecret: paymentIntent.client_secret
      })
    })

    app.patch('/bookings/payment/:id', async(req, res) => {
      const {id} = req.params;
      const {transactionId} = req.body;
      const filter = {_id: new ObjectId(id)};
      const updateDoc = {
        $set: {
          transactionId, status:'In Review', paidAt: new Date()
        }
      };
      const result = await bookingsCollection.updateOne(filter, updateDoc);
      res.send({message: 'Payment successful, booking status updated.'})
    })

    app.delete('/bookings/:id', async(req, res) => {
      const {id} = req.params;
      const query = {_id: new ObjectId(id)};
      const result = await bookingsCollection.deleteOne(query);
      res.send(result);
    })



    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
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