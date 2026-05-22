from sqlalchemy import Column, Integer, String, Text, ForeignKey
from database import Base

# =========================
# USER TABLE
# =========================
class User(Base):

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)

    name = Column(String)

    email = Column(String, unique=True)

    password = Column(String)


# =========================
# INTERVIEW TABLE
# =========================
class Interview(Base):

    __tablename__ = "interviews"

    id = Column(Integer, primary_key=True, index=True)

    user_email = Column(String)

    question = Column(Text)

    answer = Column(Text)

    score = Column(Integer)

    feedback = Column(Text)

    improvements = Column(Text)

    ideal_answer = Column(Text)