require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const port = process.env.PORT || 5000;



app.use(cors({
  origin: [
    'http://localhost:5174',
    'http://localhost:5173',
    'https://travelcove-cc125.web.app',
    'https://travelcove-cc125.firebaseapp.com',
  ],methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
}));
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
    // await client.connect();

    const userCollection = client.db('TourismDB').collection('users');
    const storiesCollection = client.db('TourismDB').collection('stories');
    const packageCollection = client.db('TourismDB').collection('packages');
    const guideApplicationCollection = client.db('TourismDB').collection('guideApplications')
    const bookingsCollection = client.db('TourismDB').collection('bookings')

    app.post('/jwt', async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '10h' });
      res.send({ token });
    })

    // middlewares
    const verifyToken = (req, res, next) => {
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

    // tour guide verify
    app.get('/users/tour-guide/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email: email });
      let tourGuide = false;
      if (user) {
        tourGuide = user?.role === 'tour-guide'
      }
      res.send({ tourGuide });
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
        { $group: { _id: null, total: { $sum: '$price' } } },
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
      const { name, photo, phone, address } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateFields = {};
      if (name) updateFields.name = name;
      if (photo) updateFields.photo = photo;
      if (phone) updateFields.phone = phone;  // ✅ Ensure new phone data is stored
      if (address) updateFields.address = address;
      const updatedDoc = {
        $set: { ...updateFields, updatedAt: new Date() }
      }
      const result = await userCollection.updateOne(filter, updatedDoc);
      if (result.matchedCount === 0) {
        return res.status(404).send({ message: 'User not found' });
      }
      res.send({ message: 'Profile updated successfully.',  updatedUser: updatedDoc });
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

    app.get('/guides/:id', async (req, res) => {
      const { id } = req.params;
      try {
        const guide = await userCollection.findOne({ _id: new ObjectId(id), role: 'tour-guide' });
        if (!guide) {
          return res.status(404).send({ message: 'Guide not found.' });
        }

        const stories = await storiesCollection.find({ userId: new ObjectId(id) }).toArray();
        guide.stories = stories;

        res.send(guide);
      } catch (error) {
        console.error('Error fetching guide details:', error);
        res.status(500).send({ message: 'Failed to fetch guide details.' });
      }
    });


    app.get('/assigned-tours', async (req, res) => {
      const { guideEmail } = req.query;
      const assignedTours = await bookingsCollection.find({ guideEmail: guideEmail }).toArray();
      res.send(assignedTours);
    });

    app.patch('/assigned-tours/accept/:id', async (req, res) => {
      const { id } = req.params;
      const result = await bookingsCollection.updateOne(
        { _id: new ObjectId(id), status: 'In Review' },
        { $set: { status: 'Accepted', acceptedAt: new Date() } }
      )
      if (result.modifiedCount === 0) {
        return res.send({ message: 'Failed to accept the tour. Either it is not in-review or does not exist.' });
      }
      res.send({ message: 'Tour accepted successfully.' })
    })

    app.patch('/assigned-tours/reject/:id', async (req, res) => {
      const { id } = req.params;
      try {
        const result = await bookingsCollection.updateOne(
          { _id: new ObjectId(id), status: 'In Review' },
          { $set: { status: 'Rejected', rejectedAt: new Date() } }
        );

        if (result.modifiedCount === 0) {
          return res.send({ message: 'Failed to reject the tour. Either it is not in-review or does not exist.' });
        }

        res.send({ message: 'Tour rejected successfully.' });
      } catch (error) {
        console.error('Error rejecting tour:', error);
        res.send({ message: 'Failed to reject tour.' });
      }
    });

    app.delete('/assigned-tours/:id', async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await guideApplicationCollection.deleteOne(query);
      if (result.deletedCount === 0) {
        return res.send({ message: 'Tour cancelled.' })
      }
      res.send({ message: 'Application deleted and reject successfully' })
    })


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
        const { email } = application;

        const updateUser = await userCollection.updateOne(
          { email },
          { $set: { role: 'tour-guide' } }
        )

        if (updateUser.modifiedCount === 0) {
          return res.status(400).send({ message: 'Failed to update user role.' });
        }

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


    // package related api
    app.get('/packages', async (req, res) => {
      const packages = await packageCollection.find().toArray();
      res.send(packages);
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

    app.post('/packages', async (req, res) => {
      try {
        const { title, description, price, tourPlan, tourType, coverImage, galleryImages } = req.body;
    
        // Validate required fields
        if (!title || !description || !price || !coverImage || !tourPlan) {
          return res.status(400).send({ message: 'Missing required fields' });
        }
    
        // Save package to database
        const newPackage = {
          title,
          description,
          price: parseFloat(price),
          tourPlan,
          tourType,
          coverImage,
          galleryImages,
          createdAt: new Date(),
        };
    
        const result = await packageCollection.insertOne(newPackage);
    
        res.status(200).send({ message: 'Package added successfully', packageId: result.insertedId });
      } catch (error) {
        console.error('Error in /packages endpoint:', error); // Log the error
        res.status(500).send({ message: 'Internal Server Error', error: error.message });
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

    app.get('/bookings/:id', async (req, res) => {
      const { id } = req.params;
      const result = await bookingsCollection.findOne({ _id: new ObjectId(id) });
      if (!result) {
        return res.send({ message: 'Booking not found' })

      }
      res.send(result)
    })

    app.post('/bookings', async (req, res) => {
      const { packageName, touristName, touristEmail, touristImage, price, tourDate, guideName, guideEmail, status = 'pending' } = req.body;

      if (!packageName || !touristName || !touristEmail || !tourDate || !price) {
        return res.status(400).send({ message: 'Missing required booking details' });
      }

      const booking = { packageName, touristName, touristEmail, touristImage, price, tourDate, guideName, guideEmail, status, createdAt: new Date() };
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

    app.patch('/bookings/payment/:id', async (req, res) => {
      const { id } = req.params;
      const { transactionId } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          transactionId, status: 'In Review', paidAt: new Date()
        }
      };
      const result = await bookingsCollection.updateOne(filter, updateDoc);
      res.send({ message: 'Payment successful, booking status updated.' })
    })

    app.delete('/bookings/:id', async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await bookingsCollection.deleteOne(query);
      res.send(result);
    })



    // stories related api
    app.get('/stories', async (req, res) => {
      const { email } = req.query;
      try {
        let query = {};
        if (email) {
          query = { userEmail: email }
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

    app.post('/stories', async (req, res) => {
      try {
        const { title, description, userEmail , images} = req.body;

        if (!title || !description || !images || !Array.isArray(images) || images.length === 0) {
          return res.status(400).send({ message: 'Title, description, and at least one image are required' });
        }

        const story = {
          title, description, userEmail, images, createdAt: new Date(),
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

module.exports = app;